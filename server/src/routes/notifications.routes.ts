import { Router, Response, NextFunction } from 'express';
import { getPrisma } from '../db/prisma.ts';
import { AuthRequest, requireAuth, requireCsrf } from '../middleware/security.ts';
import { createReportSchema } from '../validation/schemas.ts';
import { recordAuditLog } from '../services/audit.service.ts';
import { Errors } from '../utils/errors.ts';
import { env } from '../config/env.ts';
import { z } from 'zod';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4096).refine((value) => new URL(value).protocol === 'https:'),
  expirationTime: z.number().positive().max(8.64e15).nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

const pushEndpointSchema = z.object({
  endpoint: z.string().url().max(4096).refine((value) => new URL(value).protocol === 'https:'),
});

notificationsRouter.get('/push/config', (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      enabled: env.webPush.enabled,
      publicKey: env.webPush.enabled ? env.webPush.publicKey : null,
    },
  });
});

notificationsRouter.get('/push/subscriptions/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : '';
    const currentSubscription = endpoint
      ? await getPrisma().pushSubscription.findFirst({
          where: { userId: req.authUser!.id, endpoint },
          select: { id: true },
        })
      : null;

    res.json({
      success: true,
      data: {
        enabled: env.webPush.enabled,
        currentDeviceRegistered: Boolean(currentSubscription),
      },
    });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post(
  '/push/subscriptions',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!env.webPush.enabled) {
        throw Errors.badRequest('Device notifications are not configured on the server.', 'PUSH_NOT_CONFIGURED');
      }

      const input = pushSubscriptionSchema.parse(req.body);
      const subscription = await getPrisma().pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        update: {
          userId: req.authUser!.id,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          expirationTime: input.expirationTime ? new Date(input.expirationTime) : null,
        },
        create: {
          userId: req.authUser!.id,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          expirationTime: input.expirationTime ? new Date(input.expirationTime) : null,
        },
        select: { id: true },
      });

      res.status(201).json({ success: true, data: { subscriptionId: subscription.id } });
    } catch (err) {
      next(err);
    }
  }
);

notificationsRouter.delete(
  '/push/subscriptions',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { endpoint } = pushEndpointSchema.parse(req.body);
      const result = await getPrisma().pushSubscription.deleteMany({
        where: { userId: req.authUser!.id, endpoint },
      });
      res.json({ success: true, data: { removed: result.count > 0 } });
    } catch (err) {
      next(err);
    }
  }
);

notificationsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const userId = req.authUser!.id;
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId,
          ...(unreadOnly ? { isRead: false } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          actor: {
            select: { id: true, username: true, displayName: true, avatarUrl: true },
          },
        },
      }),
      prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.patch(
  '/:id/read',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      const prisma = getPrisma();
      const notif = await prisma.notification.findFirst({
        where: { id, userId: req.authUser!.id },
      });

      if (!notif) {
        throw Errors.notFound('Notification not found.');
      }

      const updated = await prisma.notification.update({
        where: { id: notif.id },
        data: { isRead: true, readAt: new Date() },
      });

      res.json({ success: true, data: { notification: updated } });
    } catch (err) {
      next(err);
    }
  }
);

notificationsRouter.post(
  '/read-all',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const prisma = getPrisma();
      const result = await prisma.notification.updateMany({
        where: { userId: req.authUser!.id, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });

      res.json({ success: true, data: { markedCount: result.count } });
    } catch (err) {
      next(err);
    }
  }
);

// Submit abuse or content moderation report
notificationsRouter.post(
  '/reports',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const input = createReportSchema.parse(req.body);
      const prisma = getPrisma();
      const reporterId = req.authUser!.id;

      let resolvedTargetUserId = input.targetUserId ?? null;
      let resolvedConversationId = input.conversationId ?? null;

      if (input.messageId) {
        const msg = await prisma.message.findUnique({
          where: { id: input.messageId },
          select: { id: true, senderId: true, conversationId: true },
        });
        if (!msg) {
          throw Errors.notFound('Reported message not found.');
        }
        resolvedTargetUserId = resolvedTargetUserId ?? msg.senderId;
        resolvedConversationId = resolvedConversationId ?? msg.conversationId;
      }

      if (resolvedTargetUserId === reporterId) {
        throw Errors.badRequest('You cannot submit an abuse report against yourself.');
      }

      const report = await prisma.abuseReport.create({
        data: {
          reporterId,
          targetUserId: resolvedTargetUserId,
          conversationId: resolvedConversationId,
          messageId: input.messageId ?? null,
          reason: input.reason,
          details: input.details,
        },
      });

      await recordAuditLog({
        actorId: reporterId,
        targetUserId: resolvedTargetUserId,
        action: 'ABUSE_REPORT_SUBMITTED',
        entityType: 'AbuseReport',
        entityId: report.id,
        metadata: { reason: input.reason },
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
      });

      res.status(201).json({
        success: true,
        data: { report },
      });
    } catch (err) {
      next(err);
    }
  }
);
