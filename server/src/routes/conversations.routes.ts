import { Prisma } from '@prisma/client';
import { Router, Response, NextFunction } from 'express';
import { getPrisma } from '../db/prisma.ts';
import { AuthRequest, requireAuth, requireCsrf } from '../middleware/security.ts';
import {
  createDirectConversationSchema,
  createGroupConversationSchema,
  editMessageSchema,
  manageGroupMembersSchema,
  sendMessageSchema,
  updateConversationPrefSchema,
  updateGroupSchema,
} from '../validation/schemas.ts';
import {
  assertActiveMembership,
  deleteMessagePersistent,
  editMessagePersistent,
  formatHydratedMessage,
  markConversationReadPersistent,
  messageInclude,
  sendMessagePersistent,
} from '../services/message.service.ts';
import { sendPushNotification } from '../services/push.service.ts';
import { realtimeHub } from '../realtime/hub.ts';
import { Errors } from '../utils/errors.ts';

export const conversationsRouter = Router();

conversationsRouter.use(requireAuth);

async function hydrateConversationForUser(conversationId: string, viewerId: string) {
  const prisma = getPrisma();
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      groupMetadata: true,
      members: {
        where: { leftAt: null },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
              bio: true,
              role: true,
              presence: {
                select: { isOnline: true, lastSeenAt: true, customStatus: true },
              },
              settings: {
                select: { onlineStatusVisible: true },
              },
            },
          },
        },
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: messageInclude,
      },
    },
  });

  if (!conv) {
    throw Errors.notFound('Conversation not found.');
  }

  const viewerMember = conv.members.find((m) => m.userId === viewerId);
  if (!viewerMember) {
    throw Errors.forbidden('You do not have access to this conversation.');
  }

  const otherMember =
    conv.type === 'DIRECT'
      ? conv.members.find((m) => m.userId !== viewerId) ?? viewerMember
      : null;

  return {
    id: conv.id,
    type: conv.type,
    lastMessageAt: conv.lastMessageAt,
    createdAt: conv.createdAt,
    isPinned: viewerMember.isPinned,
    isMuted: viewerMember.isMuted,
    myRole: viewerMember.role,
    unreadCount: viewerMember.unreadCount,
    groupMetadata: conv.groupMetadata,
    directPeer: otherMember
      ? {
          id: otherMember.user.id,
          username: otherMember.user.username,
          displayName: otherMember.user.displayName,
          avatarUrl: otherMember.user.avatarUrl,
          bio: otherMember.user.bio,
          presence:
            otherMember.user.settings?.onlineStatusVisible !== false
              ? otherMember.user.presence
              : { isOnline: false, lastSeenAt: null, customStatus: null },
        }
      : null,
    members: conv.members.map((m) => ({
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: {
        id: m.user.id,
        username: m.user.username,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        presence:
          m.user.settings?.onlineStatusVisible !== false
            ? m.user.presence
            : { isOnline: false, lastSeenAt: null, customStatus: null },
      },
    })),
    lastMessage: conv.messages[0] ? formatHydratedMessage(conv.messages[0]) : null,
  };
}

conversationsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const prisma = getPrisma();
    const userId = req.authUser!.id;
    const filterType = req.query.type === 'DIRECT' || req.query.type === 'GROUP' ? req.query.type : undefined;
    const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const memberships = await prisma.conversationMember.findMany({
      where: {
        userId,
        leftAt: null,
        ...(filterType ? { conversation: { type: filterType } } : {}),
      },
      select: {
        conversationId: true,
        isPinned: true,
        conversation: { select: { lastMessageAt: true } },
      },
    });

    memberships.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return b.conversation.lastMessageAt.getTime() - a.conversation.lastMessageAt.getTime();
    });

    const hydrated = await Promise.all(
      memberships.map((m) => hydrateConversationForUser(m.conversationId, userId))
    );

    const filtered = searchQuery
      ? hydrated.filter((c) => {
          if (c.type === 'GROUP') {
            return (
              c.groupMetadata?.name.toLowerCase().includes(searchQuery) ||
              c.groupMetadata?.description.toLowerCase().includes(searchQuery)
            );
          }
          return (
            c.directPeer?.displayName.toLowerCase().includes(searchQuery) ||
            c.directPeer?.username.toLowerCase().includes(searchQuery)
          );
        })
      : hydrated;

    res.json({
      success: true,
      data: { conversations: filtered },
    });
  } catch (err) {
    next(err);
  }
});

conversationsRouter.post(
  '/direct',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { targetUserId } = createDirectConversationSchema.parse(req.body);
      const userId = req.authUser!.id;

      if (targetUserId === userId) {
        throw Errors.badRequest('Cannot start a direct conversation with yourself.');
      }

      const prisma = getPrisma();
      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser || targetUser.status !== 'ACTIVE') {
        throw Errors.notFound('Recipient user is unavailable or does not exist.');
      }

      const directKey = [userId, targetUserId].sort().join(':');

      let conv: { id: string };
      try {
        conv = await prisma.$transaction(async (tx) => {
          const existing = await tx.conversation.findUnique({
            where: { directKey },
          });
          if (existing) {
            await tx.conversationMember.updateMany({
              where: { conversationId: existing.id, userId: { in: [userId, targetUserId] } },
              data: { leftAt: null },
            });
            return existing;
          }

          return tx.conversation.create({
            data: {
              type: 'DIRECT',
              directKey,
              createdById: userId,
              members: {
                create: [
                  { userId, role: 'MEMBER' },
                  { userId: targetUserId, role: 'MEMBER' },
                ],
              },
            },
          });
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
          throw err;
        }

        const target = err.meta?.target;
        const isDirectKeyConflict = Array.isArray(target)
          ? target.includes('directKey')
          : typeof target === 'string' && target.includes('directKey');
        if (!isDirectKeyConflict) throw err;

        const existing = await prisma.conversation.findUnique({ where: { directKey } });
        if (!existing) throw err;

        await prisma.conversationMember.updateMany({
          where: { conversationId: existing.id, userId: { in: [userId, targetUserId] } },
          data: { leftAt: null },
        });
        conv = existing;
      }

      const forCreator = await hydrateConversationForUser(conv.id, userId);
      const forPeer = await hydrateConversationForUser(conv.id, targetUserId);
      realtimeHub.emitToUser(targetUserId, 'conversation:created', { conversation: forPeer });

      res.status(201).json({
        success: true,
        data: { conversation: forCreator },
      });
    } catch (err) {
      next(err);
    }
  }
);

conversationsRouter.post(
  '/group',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const input = createGroupConversationSchema.parse(req.body);
      const creatorId = req.authUser!.id;
      const prisma = getPrisma();

      const uniqueOtherIds = Array.from(new Set(input.memberIds.filter((id) => id !== creatorId)));
      if (uniqueOtherIds.length === 0) {
        throw Errors.badRequest('Select at least one other active user to create a group.');
      }

      const validUsers = await prisma.user.findMany({
        where: { id: { in: uniqueOtherIds }, status: 'ACTIVE' },
        select: { id: true },
      });

      if (validUsers.length !== uniqueOtherIds.length) {
        throw Errors.badRequest('One or more selected group members are invalid or inactive.');
      }

      const { conv, notifications } = await prisma.$transaction(async (tx) => {
        const created = await tx.conversation.create({
          data: {
            type: 'GROUP',
            createdById: creatorId,
            groupMetadata: {
              create: {
                name: input.name,
                description: input.description,
                onlyAdminsCanPost: input.onlyAdminsCanPost,
              },
            },
            members: {
              create: [
                { userId: creatorId, role: 'OWNER' },
                ...uniqueOtherIds.map((uid) => ({ userId: uid, role: 'MEMBER' as const })),
              ],
            },
            messages: {
              create: {
                clientMessageId: `sys_create_${Date.now()}_${creatorId}`,
                senderId: creatorId,
                type: 'SYSTEM',
                content: `${req.authUser!.displayName} created group "${input.name}"`,
              },
            },
          },
        });

        const createdNotifications = await Promise.all(
          uniqueOtherIds.map((uid) =>
            tx.notification.create({
              data: {
                userId: uid,
                actorId: creatorId,
                conversationId: created.id,
                type: 'GROUP_INVITE',
                title: `Added to "${input.name}"`,
                body: `${req.authUser!.displayName} added you to ${input.name}.`,
              },
            })
          )
        );

        return { conv: created, notifications: createdNotifications };
      });

      for (const notification of notifications) {
        realtimeHub.emitToUser(notification.userId, 'notification:new', { notification });
        void sendPushNotification(notification.userId, notification);
      }

      const allParticipantIds = [creatorId, ...uniqueOtherIds];
      for (const uid of allParticipantIds) {
        const view = await hydrateConversationForUser(conv.id, uid);
        realtimeHub.emitToUser(uid, 'conversation:created', { conversation: view });
      }

      const hydrated = await hydrateConversationForUser(conv.id, creatorId);
      res.status(201).json({
        success: true,
        data: { conversation: hydrated },
      });
    } catch (err) {
      next(err);
    }
  }
);

conversationsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const conversationId = String(req.params.id);
    const hydrated = await hydrateConversationForUser(conversationId, req.authUser!.id);
    res.json({ success: true, data: { conversation: hydrated } });
  } catch (err) {
    next(err);
  }
});

conversationsRouter.patch(
  '/:id/group',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.id);
      const input = updateGroupSchema.parse(req.body);
      const membership = await assertActiveMembership(conversationId, req.authUser!.id);

      if (membership.conversation.type !== 'GROUP') {
        throw Errors.badRequest('Only group conversations have group settings.');
      }

      if (
        membership.conversation.groupMetadata?.onlyAdminsCanEditInfo !== false &&
        membership.role === 'MEMBER'
      ) {
        throw Errors.forbidden('Only group owners and administrators can edit group details.');
      }

      const prisma = getPrisma();
      await prisma.groupMetadata.update({
        where: { conversationId },
        data: input,
      });

      const hydrated = await hydrateConversationForUser(conversationId, req.authUser!.id);
      realtimeHub.emitToConversation(conversationId, 'conversation:updated', {
        conversationId,
        groupMetadata: hydrated.groupMetadata,
      });

      res.json({ success: true, data: { conversation: hydrated } });
    } catch (err) {
      next(err);
    }
  }
);

conversationsRouter.post(
  '/:id/members',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.id);
      const { userIds } = manageGroupMembersSchema.parse(req.body);
      const membership = await assertActiveMembership(conversationId, req.authUser!.id);

      if (membership.conversation.type !== 'GROUP') {
        throw Errors.badRequest('Cannot add members to a direct conversation.');
      }
      if (membership.role === 'MEMBER') {
        throw Errors.forbidden('Only group administrators can add members.');
      }

      const prisma = getPrisma();
      const validUsers = await prisma.user.findMany({
        where: { id: { in: userIds }, status: 'ACTIVE' },
        select: { id: true, displayName: true },
      });

      await prisma.$transaction(async (tx) => {
        for (const u of validUsers) {
          await tx.conversationMember.upsert({
            where: {
              conversationId_userId: { conversationId, userId: u.id },
            },
            update: { leftAt: null, role: 'MEMBER', joinedAt: new Date() },
            create: { conversationId, userId: u.id, role: 'MEMBER' },
          });
        }
      });

      for (const u of validUsers) {
        const view = await hydrateConversationForUser(conversationId, u.id);
        realtimeHub.emitToUser(u.id, 'conversation:created', { conversation: view });
      }

      const hydrated = await hydrateConversationForUser(conversationId, req.authUser!.id);
      realtimeHub.emitToConversation(conversationId, 'conversation:members_changed', {
        conversationId,
        members: hydrated.members,
      });

      res.json({ success: true, data: { conversation: hydrated } });
    } catch (err) {
      next(err);
    }
  }
);

conversationsRouter.delete(
  '/:id/members/:memberUserId',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.id);
      const targetUserId = String(req.params.memberUserId);
      const actorId = req.authUser!.id;
      const actorMembership = await assertActiveMembership(conversationId, actorId);

      if (actorMembership.conversation.type !== 'GROUP') {
        throw Errors.badRequest('Cannot remove members from a direct conversation.');
      }

      const isSelfLeave = targetUserId === actorId;
      if (!isSelfLeave && actorMembership.role === 'MEMBER') {
        throw Errors.forbidden('Only group administrators can remove members.');
      }

      const prisma = getPrisma();
      const targetMembership = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: { conversationId, userId: targetUserId },
        },
      });

      if (!targetMembership || targetMembership.leftAt !== null) {
        throw Errors.notFound('Member not found in this group.');
      }

      if (!isSelfLeave && targetMembership.role === 'OWNER') {
        throw Errors.forbidden('The group owner cannot be removed.');
      }

      await prisma.conversationMember.update({
        where: { id: targetMembership.id },
        data: { leftAt: new Date() },
      });

      realtimeHub.emitToUser(targetUserId, 'conversation:removed', { conversationId });
      realtimeHub.emitToConversation(conversationId, 'conversation:member_left', {
        conversationId,
        userId: targetUserId,
      });

      res.json({ success: true, data: { removedUserId: targetUserId } });
    } catch (err) {
      next(err);
    }
  }
);

conversationsRouter.patch(
  '/:id/preferences',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.id);
      const input = updateConversationPrefSchema.parse(req.body);
      const userId = req.authUser!.id;
      await assertActiveMembership(conversationId, userId);

      const prisma = getPrisma();
      const updated = await prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: {
          ...(input.isPinned !== undefined
            ? { isPinned: input.isPinned, pinnedAt: input.isPinned ? new Date() : null }
            : {}),
          ...(input.isMuted !== undefined
            ? { isMuted: input.isMuted, mutedUntil: null }
            : {}),
        },
      });

      res.json({
        success: true,
        data: {
          conversationId,
          isPinned: updated.isPinned,
          isMuted: updated.isMuted,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// Cursor-based message pagination + reconnection delta sync + message search
conversationsRouter.get(
  '/:id/messages',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.id);
      await assertActiveMembership(conversationId, req.authUser!.id);

      const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
      const afterIso = typeof req.query.after === 'string' && req.query.after ? req.query.after : undefined;
      const searchQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 30));

      const prisma = getPrisma();

      if (afterIso) {
        const afterDate = new Date(afterIso);
        if (Number.isNaN(afterDate.getTime())) {
          throw Errors.badRequest('Invalid "after" timestamp parameter.');
        }
        const missed = await prisma.message.findMany({
          where: {
            conversationId,
            updatedAt: { gt: afterDate },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 150,
          include: messageInclude,
        });
        res.json({
          success: true,
          data: {
            messages: missed.map(formatHydratedMessage),
            nextCursor: null,
            hasMore: false,
          },
        });
        return;
      }

      const rows = await prisma.message.findMany({
        where: {
          conversationId,
          ...(searchQ
            ? {
                isDeleted: false,
                content: { contains: searchQ, mode: 'insensitive' },
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: messageInclude,
      });

      const hasMore = rows.length > limit;
      const slice = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

      // Return chronological order for rendering while preserving cursor for older pages
      const chronological = [...slice].reverse().map(formatHydratedMessage);

      res.json({
        success: true,
        data: {
          messages: chronological,
          nextCursor,
          hasMore,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

conversationsRouter.post(
  '/:id/messages',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.id);
      const input = sendMessageSchema.parse(req.body);
      const result = await sendMessagePersistent({
        senderId: req.authUser!.id,
        conversationId,
        clientMessageId: input.clientMessageId,
        content: input.content,
        type: input.type,
        replyToId: input.replyToId,
        attachmentIds: input.attachmentIds,
      });

      res.status(result.duplicate ? 200 : 201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

conversationsRouter.patch(
  '/:id/messages/:messageId',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.id);
      const messageId = String(req.params.messageId);
      const { content } = editMessageSchema.parse(req.body);

      const message = await editMessagePersistent({
        userId: req.authUser!.id,
        conversationId,
        messageId,
        content,
      });

      res.json({ success: true, data: { message } });
    } catch (err) {
      next(err);
    }
  }
);

conversationsRouter.delete(
  '/:id/messages/:messageId',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.id);
      const messageId = String(req.params.messageId);
      const message = await deleteMessagePersistent({
        actorUserId: req.authUser!.id,
        isGlobalAdmin: req.authUser!.role === 'ADMIN',
        conversationId,
        messageId,
      });

      res.json({ success: true, data: { message } });
    } catch (err) {
      next(err);
    }
  }
);

conversationsRouter.post(
  '/:id/read',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.id);
      const result = await markConversationReadPersistent(req.authUser!.id, conversationId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
