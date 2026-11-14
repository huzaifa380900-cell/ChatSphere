import Pusher from 'pusher-js';
import { apiClient } from './api.ts';

let pusherClient: Pusher | null = null;

export function getPusherClient(): Pusher | null {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  if (!key || !cluster) return null;

  if (!pusherClient) {
    pusherClient = new Pusher(key, {
      cluster,
      forceTLS: true,
      authorizer: (channel) => ({
        authorize: (socketId, callback) => {
          void apiClient
            .post('/realtime/auth', {
              socket_id: socketId,
              channel_name: channel.name,
            })
            .then((response) => callback(null, response.data))
            .catch((error: Error) => callback(error, null));
        },
      }),
    });
  }

  return pusherClient;
}
