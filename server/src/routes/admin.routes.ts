import { Router, Response, NextFunction } from 'express';
import { AccountStatus, Role, ReportStatus } from '@prisma/client';
import { env } from '../config/env.ts';
import { checkDatabaseHealth, getPrisma } from '../db/prisma.ts';
import {
  AuthRequest,
  requireAdmin,
  requireAuth,
  requireCsrf,
} from '../middleware/security.ts';
import {
  adminResolveReportSchema,
  adminUpdateUserStatusSchema,
} from '../validation/schemas.ts';
import { deleteMessagePersistent } from '../services/message.service.ts';
import { recordAuditLog } from '../services/audit.service.ts';
import { socketHub } from '../socket/hub.ts';
import { Errors } from '../utils/errors.ts';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/overview', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      pendingUsers,
      onlineUsers,
      newUsers7d,
      totalConversations,
      totalGroups,
      totalMessages,
      totalAttachments,
      openReports,
      dbHealth,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { status: 'SUSPENDED' } }),
      prisma.user.count({ where: { status: 'PENDING_VERIFICATION' } }),
      prisma.userPresence.count({ where: { isOnline: true } }),
      prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.conversation.count(),
      prisma.conversation.count({ where: { type: 'GROUP' } }),
      prisma.message.count({ where: { isDeleted: false } }),
      prisma.messageAttachment.count({ where: { status: 'ATTACHED' } }),
      prisma.abuseReport.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
      checkDatabaseHealth(),
    ]);

    res.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          activeUsers,
          suspendedUsers,
          pendingUsers,
          onlineUsers,
          newUsers7d,
          totalConversations,
          totalGroups,
          totalMessages,
          totalAttachments,
          openReports,
        },
        operationalHealth: {
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          environment: env.nodeEnv,
          database: {
            healthy: dbHealth.healthy,
            latencyMs: dbHealth.latencyMs,
            engine: dbHealth.engine,
            externalNeonConfigured: env.hasExternalDatabaseUrl,
          },
          integrations: {
            cloudinaryConfigured: env.cloudinary.enabled,
            googleOAuthConfigured: env.google.enabled,
            smtpConfigured: env.smtp.enabled,
          },
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/users', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 15));
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const statusFilter =
      req.query.status === 'ACTIVE' ||
      req.query.status === 'SUSPENDED' ||
      req.query.status === 'PENDING_VERIFICATION'
        ? (req.query.status as AccountStatus)
        : undefined;
    const roleFilter =
      req.query.role === 'USER' || req.query.role === 'ADMIN'
        ? (req.query.role as Role)
        : undefined;

    const where = {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(roleFilter ? { role: roleFilter } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search.toLowerCase(), mode: 'insensitive' as const } },
              { username: { contains: search.toLowerCase(), mode: 'insensitive' as const } },
              { displayName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          role: true,
          status: true,
          suspendedReason: true,
          suspendedAt: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
          presence: { select: { isOnline: true, lastSeenAt: true } },
          _count: {
            select: {
              sentMessages: true,
              reportsAgainst: true,
            },
          },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch(
  '/users/:id/status',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const targetUserId = String(req.params.id);
      const input = adminUpdateUserStatusSchema.parse(req.body);
      const adminId = req.authUser!.id;

      if (targetUserId === adminId) {
        throw Errors.badRequest('Administrators cannot suspend their own account.');
      }

      const prisma = getPrisma();
      const target = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        throw Errors.notFound('Target user not found.');
      }

      if (target.role === 'ADMIN' && input.status === 'SUSPENDED') {
        throw Errors.forbidden('Peer administrator accounts cannot be suspended from the web UI.');
      }

      const now = new Date();
      const updated = await prisma.$transaction(async (tx) => {
        const userRecord = await tx.user.update({
          where: { id: targetUserId },
          data: {
            status: input.status,
            suspendedReason:
              input.status === 'SUSPENDED'
                ? input.reason || 'Policy violation enforced by moderator'
                : null,
            suspendedAt: input.status === 'SUSPENDED' ? now : null,
            ...(input.status === 'ACTIVE' && !target.emailVerifiedAt
              ? { emailVerifiedAt: now }
              : {}),
          },
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            role: true,
            status: true,
            suspendedReason: true,
            suspendedAt: true,
          },
        });

        if (input.status === 'SUSPENDED') {
          await tx.refreshSession.updateMany({
            where: { userId: targetUserId, revokedAt: null },
            data: { revokedAt: now },
          });
          await tx.userPresence.upsert({
            where: { userId: targetUserId },
            update: { isOnline: false, activeSocketCount: 0, lastSeenAt: now },
            create: { userId: targetUserId, isOnline: false, activeSocketCount: 0, lastSeenAt: now },
          });
        }

        return userRecord;
      });

      if (input.status === 'SUSPENDED') {
        await socketHub.disconnectUserSockets(targetUserId, 'account_suspended');
      }

      await recordAuditLog({
        actorId: adminId,
        targetUserId,
        action: input.status === 'SUSPENDED' ? 'ADMIN_USER_SUSPENDED' : 'ADMIN_USER_REACTIVATED',
        entityType: 'User',
        entityId: targetUserId,
        metadata: { reason: input.reason ?? null },
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
      });

      res.json({
        success: true,
        data: { user: updated },
      });
    } catch (err) {
      next(err);
    }
  }
);

adminRouter.get('/reports', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 15));
    const statusFilter =
      req.query.status === 'OPEN' ||
      req.query.status === 'IN_REVIEW' ||
      req.query.status === 'RESOLVED' ||
      req.query.status === 'DISMISSED'
        ? (req.query.status as ReportStatus)
        : undefined;

    const where = statusFilter ? { status: statusFilter } : {};

    const [total, reports] = await Promise.all([
      prisma.abuseReport.count({ where }),
      prisma.abuseReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          reporter: { select: { id: true, username: true, displayName: true, email: true } },
          targetUser: {
            select: { id: true, username: true, displayName: true, email: true, status: true },
          },
          reviewedBy: { select: { id: true, username: true, displayName: true } },
          message: {
            select: {
              id: true,
              content: true,
              isDeleted: true,
              conversationId: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch(
  '/reports/:id',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const reportId = String(req.params.id);
      const input = adminResolveReportSchema.parse(req.body);
      const adminId = req.authUser!.id;
      const prisma = getPrisma();

      const report = await prisma.abuseReport.findUnique({
        where: { id: reportId },
        include: { message: true, targetUser: true },
      });

      if (!report) {
        throw Errors.notFound('Abuse report not found.');
      }

      if (input.deleteReportedMessage && report.message && !report.message.isDeleted) {
        await deleteMessagePersistent({
          actorUserId: adminId,
          isGlobalAdmin: true,
          conversationId: report.message.conversationId,
          messageId: report.message.id,
        });
      }

      if (
        input.suspendTargetUser &&
        report.targetUserId &&
        report.targetUser?.role !== 'ADMIN' &&
        report.targetUserId !== adminId
      ) {
        const now = new Date();
        await prisma.$transaction([
          prisma.user.update({
            where: { id: report.targetUserId },
            data: {
              status: 'SUSPENDED',
              suspendedReason: `Moderation action on report #${report.id.slice(-6)}: ${input.resolutionNotes}`,
              suspendedAt: now,
            },
          }),
          prisma.refreshSession.updateMany({
            where: { userId: report.targetUserId, revokedAt: null },
            data: { revokedAt: now },
          }),
        ]);
        await socketHub.disconnectUserSockets(report.targetUserId, 'account_suspended');
      }

      const updated = await prisma.abuseReport.update({
        where: { id: report.id },
        data: {
          status: input.status,
          resolutionNotes: input.resolutionNotes,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
        include: {
          reporter: { select: { id: true, username: true, displayName: true } },
          targetUser: { select: { id: true, username: true, displayName: true, status: true } },
          reviewedBy: { select: { id: true, username: true, displayName: true } },
        },
      });

      await recordAuditLog({
        actorId: adminId,
        targetUserId: report.targetUserId,
        action: `ADMIN_REPORT_${input.status}`,
        entityType: 'AbuseReport',
        entityId: report.id,
        metadata: {
          deleteReportedMessage: input.deleteReportedMessage,
          suspendTargetUser: input.suspendTargetUser,
          notes: input.resolutionNotes,
        },
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
      });

      res.json({ success: true, data: { report: updated } });
    } catch (err) {
      next(err);
    }
  }
);

adminRouter.get('/audit-logs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(req.query.pageSize) || 20));
    const actionFilter = typeof req.query.action === 'string' && req.query.action ? req.query.action : undefined;

    const where = actionFilter ? { action: { contains: actionFilter, mode: 'insensitive' as const } } : {};

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: { select: { id: true, username: true, displayName: true, role: true } },
          targetUser: { select: { id: true, username: true, displayName: true } },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
