import { logger } from '../config/logger.ts';
import { env } from '../config/env.ts';
import { conversationChannel, getPusher, userChannel } from '../services/pusher.service.ts';

class RealtimeHub {
  private warnedAboutMissingConfig = false;

  private async trigger(channel: string, event: string, payload: unknown) {
    if (!env.pusher.enabled) {
      if (!this.warnedAboutMissingConfig) {
        logger.warn('Pusher is not configured; realtime events are disabled.');
        this.warnedAboutMissingConfig = true;
      }
      return;
    }

    try {
      await getPusher().trigger(channel, event, payload);
    } catch (err) {
      logger.error('Pusher event delivery failed', {
        channel,
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public emitToUser(userId: string, event: string, payload: unknown) {
    void this.trigger(userChannel(userId), event, payload);
  }

  public emitToConversation(conversationId: string, event: string, payload: unknown) {
    void this.trigger(conversationChannel(conversationId), event, payload);
  }

  public async notifyUserSessionRevoked(userId: string, reason = 'session_terminated') {
    await this.trigger(userChannel(userId), 'auth:force_logout', { reason });
  }
}

export const realtimeHub = new RealtimeHub();
