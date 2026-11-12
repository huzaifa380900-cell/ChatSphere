'use client';

import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, MessageSquare, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { useChatSocket } from '../context/ChatSocketContext.tsx';
import { useRouter } from '../context/RouterContext.tsx';
import { apiClient, extractApiError } from '../lib/api.ts';
import { DashboardShell } from '../components/DashboardShell.tsx';
import type { NotificationItem } from '../types/models.ts';

function decodeVapidPublicKey(publicKey: string): ArrayBuffer {
  const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes.buffer;
}

export function NotificationsPage() {
  const { notifications, unreadNotificationCount, refreshNotifications } = useChatSocket();
  const { navigate } = useRouter();
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushConfigured, setPushConfigured] = useState<boolean | null>(null);
  const [pushSupported, setPushSupported] = useState(true);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushSetupMessage, setPushSetupMessage] = useState<string | null>(null);

  const filtered =
    filter === 'UNREAD' ? notifications.filter((n) => !n.isRead) : notifications;

  useEffect(() => {
    let active = true;
    const checkPushStatus = async () => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window) ||
        !window.isSecureContext
      ) {
        setPushSupported(false);
        return;
      }

      try {
        const [config, registration] = await Promise.all([
          apiClient.get<{ success: boolean; data: { enabled: boolean } }>('/notifications/push/config'),
          navigator.serviceWorker.register('/service-worker.js'),
        ]);
        if (!active) return;
        setPushConfigured(config.data.data.enabled);

        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return;
        const status = await apiClient.get<{
          success: boolean;
          data: { currentDeviceRegistered: boolean };
        }>('/notifications/push/subscriptions/status', {
          params: { endpoint: subscription.endpoint },
        });
        if (active) setPushEnabled(status.data.data.currentDeviceRegistered);
      } catch (err) {
        if (active) setPushSetupMessage(extractApiError(err).message);
      }
    };

    void checkPushStatus();
    return () => {
      active = false;
    };
  }, []);

  const handleEnablePush = async () => {
    setPushBusy(true);
    let createdSubscription: PushSubscription | null = null;
    try {
      if (Notification.permission === 'denied') {
        throw new Error('Notifications are blocked. Allow them for ChatSphere in your browser or device settings.');
      }

      const permission =
        Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('Allow notifications in the browser prompt to enable device alerts.');
      }

      const config = await apiClient.get<{
        success: boolean;
        data: { enabled: boolean; publicKey: string | null };
      }>('/notifications/push/config');
      const publicKey = config.data.data.publicKey;
      if (!config.data.data.enabled || !publicKey) {
        throw new Error('Device notifications are not configured on the server yet.');
      }

      const registration = await navigator.serviceWorker.register('/service-worker.js');
      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription =
        existingSubscription ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(publicKey),
        }));
      if (!existingSubscription) createdSubscription = subscription;

      const subscriptionJson = subscription.toJSON();
      if (!subscriptionJson.endpoint || !subscriptionJson.keys?.p256dh || !subscriptionJson.keys.auth) {
        throw new Error('The browser returned an incomplete device subscription. Please try again.');
      }

      await apiClient.post('/notifications/push/subscriptions', subscriptionJson);
      setPushEnabled(true);
      toast.success('Device notifications are enabled.');
    } catch (err) {
      if (createdSubscription) {
        await createdSubscription.unsubscribe().catch((cleanupError: unknown) => {
          console.error('Unable to remove the incomplete push subscription.', cleanupError);
          return false;
        });
      }
      toast.error(extractApiError(err).message);
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/service-worker.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await apiClient.delete('/notifications/push/subscriptions', {
          data: { endpoint: subscription.endpoint },
        });
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
      toast.success('Device notifications are disabled.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setPushBusy(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiClient.post('/notifications/read-all');
      await refreshNotifications();
      toast.success('All notifications marked as read.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleOpenNotification = async (notif: NotificationItem) => {
    if (!notif.isRead) {
      try {
        await apiClient.patch(`/notifications/${notif.id}/read`);
        await refreshNotifications();
      } catch {
        // Ignore
      }
    }
    if (notif.conversationId) {
      navigate(`/chat?conversation=${encodeURIComponent(notif.conversationId)}`);
    }
  };

  return (
    <DashboardShell
      title="Notifications"
      subtitle="Live mentions, direct message alerts, and group invitations"
      headerActions={
        unreadNotificationCount > 0 ? (
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            className="btn btn-sm btn-ghost border border-base-300 gap-1.5 whitespace-nowrap"
          >
            <CheckCheck className="w-4 h-4" />
            <span>Mark All Read</span>
          </button>
        ) : undefined
      }
    >
      <div className="max-w-3xl mx-auto space-y-4">
        <section className="rounded-xl bg-base-200 border border-base-300 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Smartphone className="w-5 h-5 mt-0.5 text-primary shrink-0" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Device notifications</h2>
              <p className="text-xs text-base-content/65">
                Get message and group-invite alerts when ChatSphere is in the background.
              </p>
              {!pushSupported && (
                <p className="text-xs text-warning">
                  Push notifications need a supported browser and a secure HTTPS connection (localhost is supported).
                </p>
              )}
              {pushSupported && pushConfigured === false && (
                <p className="text-xs text-warning">
                  The server needs VAPID keys before device notifications can be enabled.
                </p>
              )}
              {pushSetupMessage && <p className="text-xs text-error">{pushSetupMessage}</p>}
            </div>
          </div>
          {pushEnabled ? (
            <button
              type="button"
              onClick={() => void handleDisablePush()}
              disabled={pushBusy}
              className="btn btn-sm btn-ghost border border-base-300"
            >
              {pushBusy ? 'Working...' : 'Turn off'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleEnablePush()}
              disabled={pushBusy || !pushSupported || pushConfigured === false}
              className="btn btn-sm btn-primary"
            >
              {pushBusy ? 'Working...' : 'Enable on this device'}
            </button>
          )}
        </section>

        <div className="inline-flex p-1 rounded-lg bg-base-200 border border-base-300 gap-1">
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              filter === 'ALL' ? 'bg-primary text-primary-content font-semibold' : ''
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('UNREAD')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer tabular-nums ${
              filter === 'UNREAD' ? 'bg-primary text-primary-content font-semibold' : ''
            }`}
          >
            Unread ({unreadNotificationCount})
          </button>
        </div>

        <div className="rounded-xl bg-base-200 border border-base-300 divide-y divide-base-300/60 overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Bell className="w-9 h-9 text-base-content/40 mx-auto" />
              <p className="text-sm font-medium">You are all caught up</p>
              <p className="text-xs text-base-content/60">
                New message alerts, @mentions, and channel invites appear here in real time.
              </p>
            </div>
          ) : (
            filtered.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void handleOpenNotification(n)}
                className={`w-full text-left p-4 flex items-start justify-between gap-4 hover:bg-base-300/40 transition-colors cursor-pointer ${
                  !n.isRead ? 'bg-primary/8' : ''
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <MessageSquare
                    className={`w-4 h-4 shrink-0 mt-1 ${
                      !n.isRead ? 'text-primary' : 'text-base-content/45'
                    }`}
                  />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-base-content">{n.title}</p>
                    <p className="text-xs text-base-content/70 line-clamp-2">{n.body}</p>
                    <p className="text-[11px] text-base-content/50 font-mono tabular-nums">
                      {new Date(n.createdAt).toLocaleString()} · {n.type}
                    </p>
                  </div>
                </div>
                {!n.isRead && (
                  <span className="text-xs font-semibold text-primary shrink-0">Unread</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
