import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { env } from '../config/env.ts';
import { getPrisma } from '../db/prisma.ts';
import { ACCESS_COOKIE_NAME } from '../middleware/security.ts';
import { verifyAccessToken } from '../utils/crypto.ts';
import {
  assertActiveMembership,
  deleteMessagePersistent,
  editMessagePersistent,
  formatHydratedMessage,
  markConversationReadPersistent,
  markUndeliveredMessagesDelivered,
  messageInclude,
  sendMessagePersistent,
} from '../services/message.service.ts';
import { editMessageSchema, sendMessageSchema } from '../validation/schemas.ts';
import { socketHub } from './hub.ts';
import { logger } from '../config/logger.ts';

interface SocketUserData {
  userId: string;
  username: string;
  displayName: string;
  role: 'USER' | 'ADMIN';
  sessionId: string;
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

async function verifyLiveSocketSession(sessionId: string, expectedUserId: string) {
  const prisma = getPrisma();
  const session = await prisma.refreshSession.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        include: { settings: true },
      },
    },
  });

  if (
    !session ||
    session.userId !== expectedUserId ||
    session.revokedAt ||
    session.expiresAt < new Date() ||
    session.user.status !== 'ACTIVE'
  ) {
    throw new Error('Unauthorized or suspended session');
  }

  return session.user;
}

export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const clean = origin.replace(/\/+$/, '');
        if (
          env.corsAllowedOrigins.includes(clean)
        ) {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
    },
    pingTimeout: 25000,
    pingInterval: 15000,
  });

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookieHeader(socket.handshake.headers.cookie);
      const token = cookies[ACCESS_COOKIE_NAME];
      if (!token) {
        return next(new Error('AUTH_REQUIRED'));
      }

      const decoded = verifyAccessToken(token);
      const user = await verifyLiveSocketSession(decoded.sessionId, decoded.sub);
      const prisma = getPrisma();
      const memberships = await prisma.conversationMember.findMany({
        where: { userId: user.id, leftAt: null },
        select: { conversationId: true },
      });

      socket.data.auth = {
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        sessionId: decoded.sessionId,
      } satisfies SocketUserData;
      socket.data.initialConversationIds = memberships.map((m) => m.conversationId);

      return next();
    } catch {
      return next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const auth = socket.data.auth as SocketUserData;
    const initialConvIds = (socket.data.initialConversationIds as string[]) || [];
    const prisma = getPrisma();

    // Join rooms synchronously on tick 0 before any async DB calls
    socket.join(`user:${auth.userId}`);
    for (const cid of initialConvIds) {
      socket.join(`conversation:${cid}`);
    }

    // Run async presence & delivery receipt initialization without delaying listener registration
    void (async () => {
      try {
        const memberships = initialConvIds.map((conversationId) => ({ conversationId }));
        const activeSocketsForUser = (await io.in(`user:${auth.userId}`).fetchSockets()).length;
        const now = new Date();
        const userSettings = await prisma.userSettings.findUnique({ where: { userId: auth.userId } });
        const statusVisible = userSettings?.onlineStatusVisible !== false;

        await prisma.userPresence.upsert({
          where: { userId: auth.userId },
          update: {
            isOnline: true,
            activeSocketCount: activeSocketsForUser,
            lastSeenAt: now,
          },
          create: {
            userId: auth.userId,
            isOnline: true,
            activeSocketCount: activeSocketsForUser,
            lastSeenAt: now,
          },
        });

        if (statusVisible) {
          for (const m of memberships) {
            socket.to(`conversation:${m.conversationId}`).emit('presence:update', {
              userId: auth.userId,
              isOnline: true,
              lastSeenAt: now.toISOString(),
            });
          }
        }

        await markUndeliveredMessagesDelivered(auth.userId);
      } catch (err) {
        logger.error('Socket connection initialization failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    // Real-time message send with DB-first persistence before acknowledgment
    socket.on('message:send', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        await verifyLiveSocketSession(auth.sessionId, auth.userId);
        const body = rawPayload as Record<string, unknown>;
        const conversationId = String(body?.conversationId ?? '');
        const parsed = sendMessageSchema.parse(body);

        const result = await sendMessagePersistent({
          senderId: auth.userId,
          conversationId,
          clientMessageId: parsed.clientMessageId,
          content: parsed.content,
          type: parsed.type,
          replyToId: parsed.replyToId,
          attachmentIds: parsed.attachmentIds,
        });

        ack?.({ success: true, data: result });
      } catch (err) {
        ack?.({
          success: false,
          error: {
            message: err instanceof Error ? err.message : 'Failed to send message.',
          },
        });
      }
    });

    socket.on('message:edit', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        await verifyLiveSocketSession(auth.sessionId, auth.userId);
        const body = rawPayload as Record<string, unknown>;
        const conversationId = String(body?.conversationId ?? '');
        const messageId = String(body?.messageId ?? '');
        const { content } = editMessageSchema.parse(body);

        const updated = await editMessagePersistent({
          userId: auth.userId,
          conversationId,
          messageId,
          content,
        });
        ack?.({ success: true, data: { message: updated } });
      } catch (err) {
        ack?.({
          success: false,
          error: { message: err instanceof Error ? err.message : 'Failed to edit message.' },
        });
      }
    });

    socket.on('message:delete', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        const user = await verifyLiveSocketSession(auth.sessionId, auth.userId);
        const body = rawPayload as Record<string, unknown>;
        const conversationId = String(body?.conversationId ?? '');
        const messageId = String(body?.messageId ?? '');

        const deleted = await deleteMessagePersistent({
          actorUserId: auth.userId,
          isGlobalAdmin: user.role === 'ADMIN',
          conversationId,
          messageId,
        });
        ack?.({ success: true, data: { message: deleted } });
      } catch (err) {
        ack?.({
          success: false,
          error: { message: err instanceof Error ? err.message : 'Failed to delete message.' },
        });
      }
    });

    socket.on('conversation:read', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        await verifyLiveSocketSession(auth.sessionId, auth.userId);
        const body = rawPayload as Record<string, unknown>;
        const conversationId = String(body?.conversationId ?? '');
        const result = await markConversationReadPersistent(auth.userId, conversationId);
        ack?.({ success: true, data: result });
      } catch (err) {
        ack?.({
          success: false,
          error: { message: err instanceof Error ? err.message : 'Failed to mark conversation read.' },
        });
      }
    });

    socket.on('typing:start', async (rawPayload: unknown) => {
      try {
        const user = await verifyLiveSocketSession(auth.sessionId, auth.userId);
        if (user.settings?.typingIndicatorsEnabled === false) return;
        const conversationId = String((rawPayload as Record<string, unknown>)?.conversationId ?? '');
        if (!conversationId) return;
        await assertActiveMembership(conversationId, auth.userId);

        socket.to(`conversation:${conversationId}`).emit('typing:update', {
          conversationId,
          userId: auth.userId,
          displayName: auth.displayName,
          isTyping: true,
        });
      } catch {
        // Ignore unauthorized typing events silently
      }
    });

    socket.on('typing:stop', async (rawPayload: unknown) => {
      try {
        await verifyLiveSocketSession(auth.sessionId, auth.userId);
        const conversationId = String((rawPayload as Record<string, unknown>)?.conversationId ?? '');
        if (!conversationId) return;
        await assertActiveMembership(conversationId, auth.userId);

        socket.to(`conversation:${conversationId}`).emit('typing:update', {
          conversationId,
          userId: auth.userId,
          displayName: auth.displayName,
          isTyping: false,
        });
      } catch {
        // Ignore
      }
    });

    // Reconnection delta synchronization
    socket.on('sync:reconnect', async (rawPayload: unknown, ack?: (resp: unknown) => void) => {
      try {
        await verifyLiveSocketSession(auth.sessionId, auth.userId);
        const body = rawPayload as { conversationId?: string; since?: string };
        await markUndeliveredMessagesDelivered(auth.userId);

        let missedMessages: ReturnType<typeof formatHydratedMessage>[] = [];
        if (body?.conversationId && body?.since) {
          await assertActiveMembership(body.conversationId, auth.userId);
          const sinceDate = new Date(body.since);
          if (!Number.isNaN(sinceDate.getTime())) {
            const rows = await prisma.message.findMany({
              where: {
                conversationId: body.conversationId,
                updatedAt: { gt: sinceDate },
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 150,
              include: messageInclude,
            });
            missedMessages = rows.map(formatHydratedMessage);
          }
        }

        ack?.({
          success: true,
          data: {
            syncedAt: new Date().toISOString(),
            missedMessages,
          },
        });
      } catch (err) {
        ack?.({
          success: false,
          error: { message: err instanceof Error ? err.message : 'Reconnection sync failed.' },
        });
      }
    });

    socket.on('disconnect', async () => {
      try {
        const remaining = (await io.in(`user:${auth.userId}`).fetchSockets()).length;
        const now = new Date();
        const isStillOnline = remaining > 0;

        await prisma.userPresence.upsert({
          where: { userId: auth.userId },
          update: {
            isOnline: isStillOnline,
            activeSocketCount: remaining,
            lastSeenAt: now,
          },
          create: {
            userId: auth.userId,
            isOnline: isStillOnline,
            activeSocketCount: remaining,
            lastSeenAt: now,
          },
        });

        if (!isStillOnline) {
          const settings = await prisma.userSettings.findUnique({ where: { userId: auth.userId } });
          if (settings?.onlineStatusVisible !== false) {
            const memberships = await prisma.conversationMember.findMany({
              where: { userId: auth.userId, leftAt: null },
              select: { conversationId: true },
            });
            for (const m of memberships) {
              io.to(`conversation:${m.conversationId}`).emit('presence:update', {
                userId: auth.userId,
                isOnline: false,
                lastSeenAt: now.toISOString(),
              });
            }
          }
        }
      } catch (err) {
        logger.debug('Socket disconnect presence cleanup skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  });

  socketHub.attach(io);
  return io;
}
