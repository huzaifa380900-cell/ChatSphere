import webpush from 'web-push';
import { env } from '../config/env.ts';
import { getPrisma } from '../db/prisma.ts';
import { logger } from '../config/logger.ts';

interface PushNotification {
  id: string;
  title: string;
  body: string;
  conversationId: string | null;
}

let vapidConfigured = false;

function configureVapid() {
  if (vapidConfigured) return;
  webpush.setVapidDetails(env.webPush.subject, env.webPush.publicKey, env.webPush.privateKey);
  vapidConfigured = true;
}

export async function sendPushNotification(userId: string, notification: PushNotification) {
  if (!env.webPush.enabled) return;

  try {
    configureVapid();
    const subscriptions = await getPrisma().pushSubscription.findMany({
      where: { userId },
    });
    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      tag: notification.id,
      url: notification.conversationId
        ? `/chat?conversation=${encodeURIComponent(notification.conversationId)}`
        : '/notifications',
    });

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload
          );
        } catch (err) {
          let statusCode: number | undefined;
          if (
            typeof err === 'object' &&
            err !== null &&
            'statusCode' in err &&
            typeof err.statusCode === 'number'
          ) {
            statusCode = err.statusCode;
          }

          if (statusCode === 404 || statusCode === 410) {
            await getPrisma().pushSubscription.deleteMany({
              where: { id: subscription.id },
            });
            return;
          }

          logger.warn('Web Push delivery failed', {
            userId,
            statusCode,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );
  } catch (err) {
    logger.error('Web Push notification dispatch failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
