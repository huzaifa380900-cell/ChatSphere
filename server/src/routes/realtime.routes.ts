import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.ts';
import { getPrisma } from '../db/prisma.ts';
import { AuthRequest, requireAuth, requireCsrf } from '../middleware/security.ts';
import { getPusher } from '../services/pusher.service.ts';
import {
  assertActiveMembership,
  markUndeliveredMessagesDelivered,
} from '../services/message.service.ts';
import { Errors } from '../utils/errors.ts';

export const realtimeRouter = Router();

realtimeRouter.post(
  '/auth',
  requireAuth,
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!env.pusher.enabled) {
        throw Errors.serviceUnavailable(
          'Realtime messaging is not configured.',
          'PUSHER_NOT_CONFIGURED'
        );
      }

      const { socket_id: socketId, channel_name: channelName } = z
        .object({
          socket_id: z.string().regex(/^\d+\.\d+$/),
          channel_name: z.string().min(1).max(200),
        })
        .parse(req.body);
      const user = req.authUser!;

      if (channelName === `private-user-${user.id}`) {
        const authorization = getPusher().authorizeChannel(socketId, channelName);
        await markUndeliveredMessagesDelivered(user.id);
        res.json(authorization);
        return;
      }

      const privateConversationPrefix = 'private-conversation-';
      const presenceConversationPrefix = 'presence-conversation-';
      const isPrivateConversation = channelName.startsWith(privateConversationPrefix);
      const isPresenceConversation = channelName.startsWith(presenceConversationPrefix);
      if (!isPrivateConversation && !isPresenceConversation) {
        throw Errors.forbidden('You are not allowed to subscribe to this realtime channel.');
      }

      const prefix = isPrivateConversation
        ? privateConversationPrefix
        : presenceConversationPrefix;
      const conversationId = channelName.slice(prefix.length);
      if (!conversationId) {
        throw Errors.badRequest('Invalid realtime channel name.');
      }
      await assertActiveMembership(conversationId, user.id);

      if (isPrivateConversation) {
        res.json(getPusher().authorizeChannel(socketId, channelName));
        return;
      }

      const prisma = getPrisma();
      const settings = await prisma.userSettings.findUnique({
        where: { userId: user.id },
        select: { onlineStatusVisible: true, typingIndicatorsEnabled: true },
      });
      res.json(
        getPusher().authorizeChannel(socketId, channelName, {
          user_id: user.id,
          user_info: {
            displayName: user.displayName,
            onlineStatusVisible: settings?.onlineStatusVisible !== false,
            typingIndicatorsEnabled: settings?.typingIndicatorsEnabled !== false,
          },
        })
      );
    } catch (err) {
      next(err);
    }
  }
);
