import { Router, Response, NextFunction } from 'express';
import { getPrisma } from '../db/prisma.ts';
import { AuthRequest, requireAuth, requireCsrf } from '../middleware/security.ts';
import {
  changePasswordSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from '../validation/schemas.ts';
import { hashPassword, verifyPassword } from '../utils/crypto.ts';
import { buildSignedDeliveryUrls, destroyCloudinaryAsset } from '../services/cloudinary.service.ts';
import { recordAuditLog } from '../services/audit.service.ts';
import { serializeSafeUser } from './auth.routes.ts';
import { Errors } from '../utils/errors.ts';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/search', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 15));
    const prisma = getPrisma();

    const users = await prisma.user.findMany({
      where: {
        id: { not: req.authUser!.id },
        status: 'ACTIVE',
        ...(query
          ? {
              OR: [
                { username: { contains: query.toLowerCase(), mode: 'insensitive' } },
                { displayName: { contains: query, mode: 'insensitive' } },
                { email: { equals: query.toLowerCase() } },
              ],
            }
          : {}),
      },
      take: limit,
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        role: true,
        presence: {
          select: {
            isOnline: true,
            lastSeenAt: true,
            customStatus: true,
          },
        },
        settings: {
          select: {
            onlineStatusVisible: true,
          },
        },
      },
    });

    const formatted = users.map((u) => {
      const visible = u.settings?.onlineStatusVisible !== false;
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        bio: u.bio,
        role: u.role,
        presence: visible
          ? u.presence
          : { isOnline: false, lastSeenAt: null, customStatus: u.presence?.customStatus ?? null },
      };
    });

    res.json({ success: true, data: { users: formatted } });
  } catch (err) {
    next(err);
  }
});

usersRouter.patch(
  '/me/profile',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const input = updateProfileSchema.parse(req.body);
      const prisma = getPrisma();
      const userId = req.authUser!.id;

      const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

      let nextAvatarUrl = currentUser.avatarUrl;
      let nextAvatarPublicId = currentUser.avatarPublicId;

      if (input.avatarAttachmentId === null) {
        if (currentUser.avatarPublicId) {
          await destroyCloudinaryAsset(currentUser.avatarPublicId, 'image');
        }
        nextAvatarUrl = null;
        nextAvatarPublicId = null;
      } else if (typeof input.avatarAttachmentId === 'string') {
        const stagedAvatar = await prisma.messageAttachment.findFirst({
          where: {
            id: input.avatarAttachmentId,
            ownerId: userId,
            attachmentKind: 'AVATAR',
            status: 'STAGED',
          },
        });
        if (!stagedAvatar) {
          throw Errors.badRequest('Avatar upload not found or unauthorized.');
        }

        const delivery = buildSignedDeliveryUrls(stagedAvatar);
        if (currentUser.avatarPublicId && currentUser.avatarPublicId !== stagedAvatar.cloudinaryPublicId) {
          await destroyCloudinaryAsset(currentUser.avatarPublicId, 'image');
        }

        nextAvatarUrl = delivery.url;
        nextAvatarPublicId = stagedAvatar.cloudinaryPublicId;

        await prisma.messageAttachment.update({
          where: { id: stagedAvatar.id },
          data: { status: 'ATTACHED' },
        });
      }

      const updatedUser = await prisma.$transaction(async (tx) => {
        if (input.customStatus !== undefined) {
          await tx.userPresence.upsert({
            where: { userId },
            update: { customStatus: input.customStatus },
            create: { userId, customStatus: input.customStatus, isOnline: true },
          });
        }

        return tx.user.update({
          where: { id: userId },
          data: {
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.bio !== undefined ? { bio: input.bio } : {}),
            avatarUrl: nextAvatarUrl,
            avatarPublicId: nextAvatarPublicId,
          },
          include: { settings: true, presence: true },
        });
      });

      res.json({
        success: true,
        data: { user: serializeSafeUser(updatedUser) },
      });
    } catch (err) {
      next(err);
    }
  }
);

usersRouter.patch(
  '/me/settings',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const input = updateSettingsSchema.parse(req.body);
      const prisma = getPrisma();
      const userId = req.authUser!.id;

      const settings = await prisma.userSettings.upsert({
        where: { userId },
        update: input,
        create: { userId, ...input },
      });

      res.json({
        success: true,
        data: { settings },
      });
    } catch (err) {
      next(err);
    }
  }
);

usersRouter.post(
  '/me/password',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const input = changePasswordSchema.parse(req.body);
      const prisma = getPrisma();
      const userId = req.authUser!.id;

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.passwordHash) {
        throw Errors.badRequest(
          'This account uses Google Sign-In and does not have a local password yet. Use Forgot Password to set one.'
        );
      }

      const matches = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!matches) {
        throw Errors.unauthorized('Current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
      }

      const newHash = await hashPassword(input.newPassword);
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { passwordHash: newHash },
        }),
        prisma.refreshSession.updateMany({
          where: {
            userId,
            id: { not: req.authUser!.sessionId },
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        }),
      ]);

      await recordAuditLog({
        actorId: userId,
        action: 'USER_PASSWORD_CHANGED',
        entityType: 'User',
        entityId: userId,
        ipAddress: req.ip,
        userAgent: req.header('user-agent'),
      });

      res.json({
        success: true,
        data: { message: 'Password changed and other active sessions revoked.' },
      });
    } catch (err) {
      next(err);
    }
  }
);
