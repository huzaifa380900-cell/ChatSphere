import Pusher from 'pusher';
import { env } from '../config/env.ts';

let pusher: Pusher | null = null;

export function getPusher(): Pusher {
  if (!env.pusher.enabled) {
    throw new Error('Realtime is not configured. Set PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, and PUSHER_CLUSTER.');
  }

  if (!pusher) {
    pusher = new Pusher({
      appId: env.pusher.appId,
      key: env.pusher.key,
      secret: env.pusher.secret,
      cluster: env.pusher.cluster,
      useTLS: true,
    });
  }

  return pusher;
}

export function conversationChannel(conversationId: string): string {
  return `private-conversation-${conversationId}`;
}

export function userChannel(userId: string): string {
  return `private-user-${userId}`;
}
