import { Prisma } from '@prisma/client';
import { getPrisma } from '../db/prisma.ts';
import { env } from '../config/env.ts';
import {
  buildSignedDeliveryUrls,
  destroyCloudinaryAsset,
} from './cloudinary.service.ts';
import { Errors } from '../utils/errors.ts';
import { realtimeHub } from '../realtime/hub.ts';
import { sendPushNotification } from './push.service.ts';

export const messageInclude = {
  sender: {
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      role: true,
    },
  },
  replyTo: {
    select: {
      id: true,
      content: true,
      type: true,
      isDeleted: true,
      sender: {
        select: { id: true, username: true, displayName: true },
      },
    },
  },
  attachments: {
    where: { status: 'ATTACHED' as const },
    select: {
      id: true,
      attachmentKind: true,
      resourceType: true,
      mimeType: true,
      originalFilename: true,
      fileExtension: true,
      fileSize: true,
      width: true,
      height: true,
      durationSeconds: true,
      accessPolicy: true,
      cloudinaryPublicId: true,
      uploadedAt: true,
    },
  },
  receipts: {
    select: {
      userId: true,
      status: true,
      deliveredAt: true,
      readAt: true,
    },
  },
} satisfies Prisma.MessageInclude;

export type HydratedMessageRecord = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;

export function formatHydratedMessage(msg: HydratedMessageRecord) {
  const formattedAttachments = msg.isDeleted
    ? []
    : msg.attachments.map((att) => {
        let delivery: { url: string | null; thumbnailUrl?: string; expiresAt?: string } = {
          url: null,
        };
        if (env.cloudinary.enabled) {
          try {
            delivery = buildSignedDeliveryUrls(att);
          } catch {
            delivery = { url: null };
          }
        }
        return {
          id: att.id,
          attachmentKind: att.attachmentKind,
          resourceType: att.resourceType,
          mimeType: att.mimeType,
          originalFilename: att.originalFilename,
          fileExtension: att.fileExtension,
          fileSize: att.fileSize,
          width: att.width,
          height: att.height,
          durationSeconds: att.durationSeconds,
          uploadedAt: att.uploadedAt,
          url: delivery.url,
          thumbnailUrl: delivery.thumbnailUrl ?? null,
          urlExpiresAt: delivery.expiresAt ?? null,
        };
      });

  return {
    id: msg.id,
    clientMessageId: msg.clientMessageId,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    sender: msg.sender,
    replyTo: msg.replyTo
      ? {
          id: msg.replyTo.id,
          content: msg.replyTo.isDeleted ? 'This message was deleted' : msg.replyTo.content,
          type: msg.replyTo.type,
          isDeleted: msg.replyTo.isDeleted,
          sender: msg.replyTo.sender,
        }
      : null,
    content: msg.isDeleted ? '' : msg.content,
    type: msg.type,
    isEdited: msg.isEdited,
    editedAt: msg.editedAt,
    isDeleted: msg.isDeleted,
    deletedAt: msg.deletedAt,
    attachments: formattedAttachments,
    receipts: msg.receipts,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

export async function assertActiveMembership(conversationId: string, userId: string) {
  const prisma = getPrisma();
  const membership = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
    include: {
      conversation: {
        include: { groupMetadata: true },
      },
    },
  });

  if (!membership || membership.leftAt !== null) {
    throw Errors.forbidden('You are not an active member of this conversation.', 'NOT_CONVERSATION_MEMBER');
  }

  return membership;
}

export async function sendMessagePersistent(params: {
  senderId: string;
  conversationId: string;
  clientMessageId: string;
  content: string;
  type: 'TEXT' | 'MEDIA' | 'VOICE';
  replyToId?: string | null;
  attachmentIds: string[];
}) {
  const prisma = getPrisma();
  const membership = await assertActiveMembership(params.conversationId, params.senderId);

  if (
    membership.conversation.type === 'GROUP' &&
    membership.conversation.groupMetadata?.onlyAdminsCanPost &&
    membership.role === 'MEMBER'
  ) {
    throw Errors.forbidden('Only group administrators can send messages in this channel.', 'GROUP_POST_RESTRICTED');
  }

  // Idempotency check: if clientMessageId was already persisted by this sender, return existing message safely
  const existingMessage = await prisma.message.findUnique({
    where: {
      senderId_clientMessageId: {
        senderId: params.senderId,
        clientMessageId: params.clientMessageId,
      },
    },
    include: messageInclude,
  });

  if (existingMessage) {
    if (existingMessage.conversationId !== params.conversationId) {
      throw Errors.conflict('Duplicate clientMessageId across conversations.', 'IDEMPOTENCY_CONFLICT');
    }
    return {
      message: formatHydratedMessage(existingMessage),
      duplicate: true,
    };
  }

  if (params.replyToId) {
    const targetReply = await prisma.message.findUnique({
      where: { id: params.replyToId },
      select: { id: true, conversationId: true },
    });
    if (!targetReply || targetReply.conversationId !== params.conversationId) {
      throw Errors.badRequest('Reply target message does not belong to this conversation.');
    }
  }

  if (params.attachmentIds.length > 0) {
    const staged = await prisma.messageAttachment.findMany({
      where: {
        id: { in: params.attachmentIds },
        ownerId: params.senderId,
        conversationId: params.conversationId,
        status: 'STAGED',
      },
    });
    if (staged.length !== params.attachmentIds.length) {
      throw Errors.badRequest(
        'One or more attachments are invalid, unauthorized, or already linked.',
        'INVALID_ATTACHMENTS'
      );
    }
  }

  const activeMembers = await prisma.conversationMember.findMany({
    where: {
      conversationId: params.conversationId,
      leftAt: null,
    },
    include: {
      user: { select: { id: true, username: true, displayName: true } },
    },
  });

  const recipientMembers = activeMembers.filter((m) => m.userId !== params.senderId);
  const senderMember = activeMembers.find((m) => m.userId === params.senderId);
  const now = new Date();

  const effectiveType =
    params.attachmentIds.length > 0 && params.type === 'TEXT' ? 'MEDIA' : params.type;

  const { createdMsg, notificationsToEmit } = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: {
        clientMessageId: params.clientMessageId,
        conversationId: params.conversationId,
        senderId: params.senderId,
        replyToId: params.replyToId ?? null,
        content: params.content.trim(),
        type: effectiveType,
      },
    });

    if (params.attachmentIds.length > 0) {
      await tx.messageAttachment.updateMany({
        where: { id: { in: params.attachmentIds }, ownerId: params.senderId },
        data: {
          messageId: msg.id,
          status: 'ATTACHED',
        },
      });
    }

    if (recipientMembers.length > 0) {
      await tx.messageReceipt.createMany({
        data: recipientMembers.map((rm) => ({
          messageId: msg.id,
          userId: rm.userId,
          status: 'SENT',
        })),
        skipDuplicates: true,
      });

      await tx.conversationMember.updateMany({
        where: {
          conversationId: params.conversationId,
          userId: { in: recipientMembers.map((rm) => rm.userId) },
          leftAt: null,
        },
        data: {
          unreadCount: { increment: 1 },
        },
      });
    }

    await tx.conversation.update({
      where: { id: params.conversationId },
      data: { lastMessageAt: now },
    });

    const lowerText = params.content.toLowerCase();
    const senderName = senderMember?.user.displayName ?? 'Someone';
    const convLabel =
      membership.conversation.type === 'GROUP'
        ? membership.conversation.groupMetadata?.name ?? 'Group'
        : senderName;

    const notificationsToEmit = await tx.notification.createManyAndReturn({
      data: recipientMembers
        .filter((member) => !member.isMuted)
        .map((member) => {
          const isMentioned = lowerText.includes(`@${member.user.username.toLowerCase()}`);
          return {
            userId: member.userId,
            actorId: params.senderId,
            conversationId: params.conversationId,
            messageId: msg.id,
            type: isMentioned ? 'MENTION' : 'NEW_MESSAGE',
            title: isMentioned
              ? `${senderName} mentioned you in ${convLabel}`
              : membership.conversation.type === 'GROUP'
                ? `${senderName} in ${convLabel}`
                : `New message from ${senderName}`,
            body:
              params.content.trim().slice(0, 140) ||
              (effectiveType === 'VOICE' ? 'Sent a voice message' : 'Sent an attachment'),
          };
        }),
    });

    const hydrated = await tx.message.findUniqueOrThrow({
      where: { id: msg.id },
      include: messageInclude,
    });

    return { createdMsg: hydrated, notificationsToEmit };
  }, { maxWait: 5000, timeout: 15000 });

  const formatted = formatHydratedMessage(createdMsg);

  realtimeHub.emitToConversation(params.conversationId, 'message:new', {
    message: formatted,
  });

  for (const m of activeMembers) {
    realtimeHub.emitToUser(m.userId, 'conversation:activity', {
      conversationId: params.conversationId,
      lastMessage: formatted,
      lastMessageAt: now.toISOString(),
      senderId: params.senderId,
    });
  }

  for (const notif of notificationsToEmit) {
    realtimeHub.emitToUser(notif.userId, 'notification:new', { notification: notif });
  }
  await Promise.all(
    notificationsToEmit.map((notif) => sendPushNotification(notif.userId, notif))
  );

  return {
    message: formatted,
    duplicate: false,
  };
}

export async function editMessagePersistent(params: {
  userId: string;
  conversationId: string;
  messageId: string;
  content: string;
}) {
  const prisma = getPrisma();
  await assertActiveMembership(params.conversationId, params.userId);

  const existing = await prisma.message.findUnique({
    where: { id: params.messageId },
  });

  if (!existing || existing.conversationId !== params.conversationId) {
    throw Errors.notFound('Message not found.');
  }

  if (existing.isDeleted) {
    throw Errors.badRequest('Deleted messages cannot be edited.');
  }

  if (existing.senderId !== params.userId) {
    throw Errors.forbidden('You can only edit your own messages.');
  }

  const updated = await prisma.message.update({
    where: { id: existing.id },
    data: {
      content: params.content.trim(),
      isEdited: true,
      editedAt: new Date(),
    },
    include: messageInclude,
  });

  const formatted = formatHydratedMessage(updated);
  realtimeHub.emitToConversation(params.conversationId, 'message:edited', {
    message: formatted,
  });

  return formatted;
}

export async function deleteMessagePersistent(params: {
  actorUserId: string;
  isGlobalAdmin: boolean;
  conversationId: string;
  messageId: string;
}) {
  const prisma = getPrisma();
  let memberRole: string | null = null;

  if (!params.isGlobalAdmin) {
    const membership = await assertActiveMembership(params.conversationId, params.actorUserId);
    memberRole = membership.role;
  }

  const existing = await prisma.message.findUnique({
    where: { id: params.messageId },
    include: { attachments: true },
  });

  if (!existing || existing.conversationId !== params.conversationId) {
    throw Errors.notFound('Message not found.');
  }

  if (existing.isDeleted) {
    const already = await prisma.message.findUniqueOrThrow({
      where: { id: existing.id },
      include: messageInclude,
    });
    return formatHydratedMessage(already);
  }

  const canDelete =
    params.isGlobalAdmin ||
    existing.senderId === params.actorUserId ||
    memberRole === 'OWNER' ||
    memberRole === 'ADMIN';

  if (!canDelete) {
    throw Errors.forbidden('You do not have permission to delete this message.');
  }

  for (const att of existing.attachments) {
    if (att.status !== 'DELETED') {
      await destroyCloudinaryAsset(att.cloudinaryPublicId, att.resourceType);
    }
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    if (existing.attachments.length > 0) {
      await tx.messageAttachment.updateMany({
        where: { messageId: existing.id },
        data: { status: 'DELETED', deletedAt: now },
      });
    }

    return tx.message.update({
      where: { id: existing.id },
      data: {
        isDeleted: true,
        content: '',
        deletedAt: now,
        deletedById: params.actorUserId,
      },
      include: messageInclude,
    });
  });

  const formatted = formatHydratedMessage(updated);
  realtimeHub.emitToConversation(params.conversationId, 'message:deleted', {
    conversationId: params.conversationId,
    messageId: existing.id,
    deletedAt: now.toISOString(),
    deletedById: params.actorUserId,
  });

  return formatted;
}

export async function markConversationReadPersistent(userId: string, conversationId: string) {
  const prisma = getPrisma();
  await assertActiveMembership(conversationId, userId);

  const userSettings = await prisma.userSettings.findUnique({ where: { userId } });
  const emitReceipts = userSettings?.readReceiptsEnabled !== false;
  const now = new Date();

  const latestMsg = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  const pendingReceipts = await prisma.messageReceipt.findMany({
    where: {
      userId,
      status: { in: ['SENT', 'DELIVERED'] },
      message: { conversationId },
    },
    select: { id: true, messageId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.conversationMember.update({
      where: {
        conversationId_userId: { conversationId, userId },
      },
      data: {
        unreadCount: 0,
        lastReadAt: now,
        lastReadMessageId: latestMsg?.id ?? null,
      },
    });

    if (emitReceipts && pendingReceipts.length > 0) {
      await tx.messageReceipt.updateMany({
        where: { id: { in: pendingReceipts.map((r) => r.id) } },
        data: {
          status: 'READ',
          deliveredAt: now,
          readAt: now,
        },
      });
    }

    await tx.notification.updateMany({
      where: { userId, conversationId, isRead: false },
      data: { isRead: true, readAt: now },
    });
  });

  if (emitReceipts && pendingReceipts.length > 0) {
    realtimeHub.emitToConversation(conversationId, 'message:receipts_updated', {
      conversationId,
      userId,
      status: 'READ',
      messageIds: pendingReceipts.map((r) => r.messageId),
      timestamp: now.toISOString(),
    });
  }

  return {
    conversationId,
    unreadCount: 0,
    markedCount: pendingReceipts.length,
  };
}

export async function markUndeliveredMessagesDelivered(userId: string) {
  const prisma = getPrisma();
  const now = new Date();

  const undelivered = await prisma.messageReceipt.findMany({
    where: {
      userId,
      status: 'SENT',
    },
    include: {
      message: { select: { conversationId: true } },
    },
    take: 250,
  });

  if (undelivered.length === 0) return;

  await prisma.messageReceipt.updateMany({
    where: { id: { in: undelivered.map((u) => u.id) } },
    data: {
      status: 'DELIVERED',
      deliveredAt: now,
    },
  });

  const byConv = new Map<string, string[]>();
  for (const item of undelivered) {
    const cid = item.message.conversationId;
    const arr = byConv.get(cid) ?? [];
    arr.push(item.messageId);
    byConv.set(cid, arr);
  }

  for (const [conversationId, messageIds] of byConv.entries()) {
    realtimeHub.emitToConversation(conversationId, 'message:receipts_updated', {
      conversationId,
      userId,
      status: 'DELIVERED',
      messageIds,
      timestamp: now.toISOString(),
    });
  }
}
