'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type Members from 'pusher-js/types/src/core/channels/members';
import type PresenceChannel from 'pusher-js/types/src/core/channels/presence_channel';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext.tsx';
import { apiClient, extractApiError } from '../lib/api.ts';
import { getPusherClient } from '../lib/pusher-client.ts';
import type {
  ChatMessage,
  ConversationItem,
  MessageAttachmentItem,
  NotificationItem,
  PublicUserSummary,
  ReceiptStatus,
} from '../types/models.ts';

interface TypingUser {
  userId: string;
  displayName: string;
}

interface RealtimeContextValue {
  connected: boolean;
  reconnecting: boolean;
  conversations: ConversationItem[];
  conversationsLoading: boolean;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  messagesByConversation: Record<string, ChatMessage[]>;
  paginationByConversation: Record<string, { nextCursor: string | null; hasMore: boolean; loading: boolean }>;
  typingByConversation: Record<string, TypingUser[]>;
  unreadNotificationCount: number;
  notifications: NotificationItem[];
  refreshConversations: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  loadMessages: (conversationId: string, cursor?: string | null) => Promise<void>;
  sendMessageOptimistic: (params: {
    conversationId: string;
    content: string;
    type?: 'TEXT' | 'MEDIA' | 'VOICE';
    replyTo?: ChatMessage | null;
    stagedAttachments?: MessageAttachmentItem[];
    existingClientMessageId?: string;
  }) => Promise<boolean>;
  retryFailedMessage: (conversationId: string, clientMessageId: string) => Promise<void>;
  discardFailedMessage: (conversationId: string, clientMessageId: string) => void;
  editMessage: (conversationId: string, messageId: string, content: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  markConversationRead: (conversationId: string) => Promise<void>;
  emitTyping: (conversationId: string) => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

function mergeMessagesIdempotent(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  const byClientMsgId = new Map<string, string>();

  for (const m of existing) {
    byId.set(m.id, m);
    if (m.clientMessageId) {
      byClientMsgId.set(`${m.senderId}:${m.clientMessageId}`, m.id);
    }
  }

  for (const m of incoming) {
    const clientKey = `${m.senderId}:${m.clientMessageId}`;
    const priorKeyId = byClientMsgId.get(clientKey);
    if (priorKeyId && priorKeyId !== m.id) {
      byId.delete(priorKeyId);
    }
    byId.set(m.id, { ...m, optimisticState: undefined, optimisticError: undefined });
    byClientMsgId.set(clientKey, m.id);
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

function sortConversations(list: ConversationItem[]): ConversationItem[] {
  return [...list].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });
}

function preserveLivePresence(
  incoming: PublicUserSummary['presence'],
  previous: PublicUserSummary['presence']
): PublicUserSummary['presence'] {
  if (
    !incoming ||
    incoming.lastSeenAt === null ||
    !previous ||
    previous.lastSeenAt === null
  ) {
    return incoming;
  }
  return {
    ...incoming,
    isOnline: previous.isOnline,
    lastSeenAt: previous.lastSeenAt,
  };
}

function mergeConversationPresence(
  incoming: ConversationItem,
  previous: ConversationItem | undefined
): ConversationItem {
  if (!previous) return incoming;

  const directPeer =
    incoming.directPeer && previous.directPeer?.id === incoming.directPeer.id
      ? {
          ...incoming.directPeer,
          presence: preserveLivePresence(
            incoming.directPeer.presence,
            previous.directPeer.presence
          ),
        }
      : incoming.directPeer;
  const previousMembers = new Map(previous.members.map((member) => [member.userId, member]));

  return {
    ...incoming,
    directPeer,
    members: incoming.members.map((member) => {
      const previousMember = previousMembers.get(member.userId);
      if (!previousMember) return member;
      return {
        ...member,
        user: {
          ...member.user,
          presence: preserveLivePresence(
            member.user.presence,
            previousMember.user.presence
          ),
        },
      };
    }),
  };
}

export function ChatRealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const userId = user?.id ?? null;
  const activeConvRef = useRef<string | null>(null);
  const lastSyncedIsoRef = useRef<string>(new Date().toISOString());
  const pendingAttachmentsMemoryRef = useRef<Map<string, MessageAttachmentItem[]>>(new Map());
  const notificationIdsRef = useRef(new Set<string>());

  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(null);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatMessage[]>>({});
  const [paginationByConversation, setPaginationByConversation] = useState<
    Record<string, { nextCursor: string | null; hasMore: boolean; loading: boolean }>
  >({});
  const [typingByConversation, setTypingByConversation] = useState<Record<string, TypingUser[]>>({});
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimeoutConversationRef = useRef<string | null>(null);
  const presenceChannelsRef = useRef(new Map<string, PresenceChannel>());
  const typingChannelBindingsRef = useRef(
    new Map<string, { channel: PresenceChannel; handler: (payload: unknown) => void }>()
  );

  const clearTypingForConversation = useCallback((conversationId: string) => {
    if (typingTimeoutConversationRef.current === conversationId && typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
      typingTimeoutConversationRef.current = null;
    }
    setTypingByConversation((prev) =>
      prev[conversationId]?.length ? { ...prev, [conversationId]: [] } : prev
    );
  }, []);

  const handleClientTyping = useCallback(
    (conversationId: string, channel: PresenceChannel, payload: unknown) => {
      if (
        !userId ||
        activeConvRef.current !== conversationId ||
        !payload ||
        typeof payload !== 'object'
      ) {
        return;
      }

      const event = payload as { userId?: unknown; userName?: unknown };
      if (
        typeof event.userId !== 'string' ||
        typeof event.userName !== 'string' ||
        event.userId === userId
      ) {
        return;
      }

      const typingUserId = event.userId;
      const member = channel.members.get(typingUserId);
      if (!member || member.info?.typingIndicatorsEnabled === false) return;

      const displayName =
        typeof member.info?.displayName === 'string' ? member.info.displayName : event.userName;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

      setTypingByConversation((prev) => {
        const existing = (prev[conversationId] || []).filter(
          (typingUser) => typingUser.userId !== typingUserId
        );
        return {
          ...prev,
          [conversationId]: [...existing, { userId: typingUserId, displayName }],
        };
      });

      const timeout = setTimeout(() => {
        if (typingTimeoutRef.current !== timeout) return;
        typingTimeoutRef.current = null;
        typingTimeoutConversationRef.current = null;
        setTypingByConversation((prev) => {
          const current = prev[conversationId] || [];
          return current.length ? { ...prev, [conversationId]: [] } : prev;
        });
      }, 3500);
      typingTimeoutRef.current = timeout;
      typingTimeoutConversationRef.current = conversationId;
    },
    [userId]
  );

  const setActiveConversationId = useCallback((id: string | null) => {
    const previousId = activeConvRef.current;
    if (previousId && previousId !== id) clearTypingForConversation(previousId);
    activeConvRef.current = id;
    setActiveConversationIdState(id);
  }, [clearTypingForConversation]);

  const refreshConversations = useCallback(async () => {
    if (!user) return;
    setConversationsLoading(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { conversations: ConversationItem[] };
      }>('/conversations');
      setConversations((current) => {
        const currentById = new Map(current.map((conversation) => [conversation.id, conversation]));
        return sortConversations(
          res.data.data.conversations.map((conversation) =>
            mergeConversationPresence(conversation, currentById.get(conversation.id))
          )
        );
      });
    } catch {
      // Handled gracefully by callers
    } finally {
      setConversationsLoading(false);
    }
  }, [user]);

  const refreshNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { notifications: NotificationItem[]; unreadCount: number };
      }>('/notifications');
      setNotifications(res.data.data.notifications);
      for (const notification of res.data.data.notifications) {
        notificationIdsRef.current.add(notification.id);
      }
      setUnreadNotificationCount(res.data.data.unreadCount);
    } catch {
      // Ignore transient errors
    }
  }, [user]);

  const markConversationRead = useCallback(
    async (conversationId: string) => {
      if (!user) return;
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
      );
      try {
        await apiClient.post(`/conversations/${conversationId}/read`);
        void refreshNotifications();
      } catch {
        // Non-blocking
      }
    },
    [user, refreshNotifications]
  );

  const loadMessages = useCallback(
    async (conversationId: string, cursor?: string | null) => {
      if (!user) return;
      setPaginationByConversation((prev) => ({
        ...prev,
        [conversationId]: {
          nextCursor: prev[conversationId]?.nextCursor ?? null,
          hasMore: prev[conversationId]?.hasMore ?? false,
          loading: true,
        },
      }));

      try {
        const res = await apiClient.get<{
          success: boolean;
          data: { messages: ChatMessage[]; nextCursor: string | null; hasMore: boolean };
        }>(`/conversations/${conversationId}/messages`, {
          params: { limit: 30, ...(cursor ? { cursor } : {}) },
        });

        const { messages, nextCursor, hasMore } = res.data.data;
        setMessagesByConversation((prev) => ({
          ...prev,
          [conversationId]: mergeMessagesIdempotent(prev[conversationId] || [], messages),
        }));
        setPaginationByConversation((prev) => ({
          ...prev,
          [conversationId]: { nextCursor, hasMore, loading: false },
        }));
        lastSyncedIsoRef.current = new Date().toISOString();
      } catch (err) {
        setPaginationByConversation((prev) => ({
          ...prev,
          [conversationId]: {
            nextCursor: prev[conversationId]?.nextCursor ?? null,
            hasMore: prev[conversationId]?.hasMore ?? false,
            loading: false,
          },
        }));
        toast.error(extractApiError(err).message);
      }
    },
    [user]
  );

  const conversationChannelIds = conversations
    .map((conversation) => conversation.id)
    .sort()
    .join(',');

  const latestActionsRef = useRef({
    logout,
    refreshConversations,
    refreshNotifications,
    markConversationRead,
    setActiveConversationId,
    clearTypingForConversation,
  });
  latestActionsRef.current = {
    logout,
    refreshConversations,
    refreshNotifications,
    markConversationRead,
    setActiveConversationId,
    clearTypingForConversation,
  };

  const reconnectingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connect and manage authenticated Pusher subscriptions.
  useEffect(() => {
    if (!userId) {
      setConnected(false);
      setReconnecting(false);
      setConversations([]);
      setMessagesByConversation({});
      setNotifications([]);
      notificationIdsRef.current.clear();
      setUnreadNotificationCount(0);
      return;
    }

    void latestActionsRef.current.refreshConversations();
    void latestActionsRef.current.refreshNotifications();

    const pusher = getPusherClient();
    if (!pusher) {
      setConnected(false);
      setReconnecting(false);
      toast.error('Realtime messaging is not configured. Add the Pusher public key and cluster.');
      return;
    }

    const handleConnect = () => {
      if (reconnectingTimeoutRef.current) {
        clearTimeout(reconnectingTimeoutRef.current);
        reconnectingTimeoutRef.current = null;
      }
      setConnected(true);
      setReconnecting(false);
      void latestActionsRef.current.refreshNotifications();

      const currentActive = activeConvRef.current;
      if (currentActive) {
        const since = lastSyncedIsoRef.current;
        void apiClient
          .get<{
            success: boolean;
            data: { messages: ChatMessage[] };
          }>(`/conversations/${currentActive}/messages`, { params: { after: since } })
          .then((response) => {
            lastSyncedIsoRef.current = new Date().toISOString();
            if (response.data.data.messages.length > 0) {
              setMessagesByConversation((prev) => ({
                ...prev,
                [currentActive]: mergeMessagesIdempotent(
                  prev[currentActive] || [],
                  response.data.data.messages
                ),
              }));
            }
          })
          .catch((error: unknown) => toast.error(extractApiError(error).message));
      }
      void latestActionsRef.current.refreshConversations();
    };

    const handleConnectionState = (states: { current: string }) => {
      const isConnected = states.current === 'connected';
      const isReconnecting = states.current === 'connecting' || states.current === 'unavailable';
      setConnected(isConnected);

      if (isConnected || !isReconnecting) {
        if (reconnectingTimeoutRef.current) {
          clearTimeout(reconnectingTimeoutRef.current);
          reconnectingTimeoutRef.current = null;
        }
        setReconnecting(false);
      } else if (!reconnectingTimeoutRef.current) {
        reconnectingTimeoutRef.current = setTimeout(() => {
          reconnectingTimeoutRef.current = null;
          if (pusher.connection.state !== 'connected') setReconnecting(true);
        }, 2000);
      }
    };

    const handleForceLogout = ({ reason }: { reason: string }) => {
      toast.error(
        reason === 'account_suspended'
          ? 'Your account has been suspended by an administrator.'
          : 'Your session was signed out.'
      );
      void latestActionsRef.current.logout();
    };

    const handleMessageNew = ({ message }: { message: ChatMessage }) => {
      lastSyncedIsoRef.current = new Date().toISOString();
      latestActionsRef.current.clearTypingForConversation(message.conversationId);
      setMessagesByConversation((prev) => ({
        ...prev,
        [message.conversationId]: mergeMessagesIdempotent(
          prev[message.conversationId] || [],
          [message]
        ),
      }));

      if (activeConvRef.current === message.conversationId && message.senderId !== userId) {
        void latestActionsRef.current.markConversationRead(message.conversationId);
      }
    };

    const handleConversationActivity = ({
      conversationId,
      lastMessage,
      lastMessageAt,
      senderId,
    }: {
      conversationId: string;
      lastMessage: ChatMessage;
      lastMessageAt: string;
      senderId: string;
    }) => {
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conversationId);
        if (!exists) {
          void latestActionsRef.current.refreshConversations();
          return prev;
        }
        const updated = prev.map((c) => {
          if (c.id !== conversationId) return c;
          const isViewing = activeConvRef.current === conversationId;
          const nextUnread =
            senderId === userId || isViewing ? 0 : (c.unreadCount || 0) + 1;
          return {
            ...c,
            lastMessage,
            lastMessageAt,
            unreadCount: nextUnread,
          };
        });
        return sortConversations(updated);
      });
    };

    const handleMessageEdited = ({ message }: { message: ChatMessage }) => {
      setMessagesByConversation((prev) => {
        const current = prev[message.conversationId];
        if (!current) return prev;
        return {
          ...prev,
          [message.conversationId]: current.map((m) => (m.id === message.id ? message : m)),
        };
      });
    };

    const handleMessageDeleted = ({
      conversationId,
      messageId,
      deletedAt,
    }: {
      conversationId: string;
      messageId: string;
      deletedAt: string;
    }) => {
      setMessagesByConversation((prev) => {
        const current = prev[conversationId];
        if (!current) return prev;
        return {
          ...prev,
          [conversationId]: current.map((m) =>
            m.id === messageId
              ? { ...m, isDeleted: true, content: '', attachments: [], deletedAt }
              : m
          ),
        };
      });
      void latestActionsRef.current.refreshConversations();
    };

    const handleReceiptsUpdated = ({
      conversationId,
      userId: receiptUserId,
      status,
      messageIds,
      timestamp,
    }: {
      conversationId: string;
      userId: string;
      status: ReceiptStatus;
      messageIds: string[];
      timestamp: string;
    }) => {
      const idSet = new Set(messageIds);
      setMessagesByConversation((prev) => {
        const current = prev[conversationId];
        if (!current) return prev;
        return {
          ...prev,
          [conversationId]: current.map((m) => {
            if (!idSet.has(m.id)) return m;
            const hasExisting = m.receipts.some((r) => r.userId === receiptUserId);
            const nextReceipts = hasExisting
              ? m.receipts.map((r) =>
                  r.userId === receiptUserId
                    ? {
                        ...r,
                        status,
                        deliveredAt: r.deliveredAt || timestamp,
                        readAt: status === 'READ' ? timestamp : r.readAt,
                      }
                    : r
                )
              : [
                  ...m.receipts,
                  {
                    userId: receiptUserId,
                    status,
                    deliveredAt: timestamp,
                    readAt: status === 'READ' ? timestamp : null,
                  },
                ];
            return { ...m, receipts: nextReceipts };
          }),
        };
      });
    };

    const handlePresenceUpdate = ({
      userId: targetUserId,
      isOnline,
      lastSeenAt,
    }: {
      userId: string;
      isOnline: boolean;
      lastSeenAt: string;
    }) => {
      setConversations((prev) =>
        prev.map((c) => ({
          ...c,
          directPeer:
            c.directPeer && c.directPeer.id === targetUserId
              ? {
                  ...c.directPeer,
                  presence: {
                    isOnline,
                    lastSeenAt,
                    customStatus: c.directPeer.presence?.customStatus ?? null,
                  },
                }
              : c.directPeer,
          members: c.members.map((m) =>
            m.userId === targetUserId
              ? {
                  ...m,
                  user: {
                    ...m.user,
                    presence: {
                      isOnline,
                      lastSeenAt,
                      customStatus: m.user.presence?.customStatus ?? null,
                    },
                  },
                }
              : m
          ),
        }))
      );
    };

    const handleConversationCreated = ({ conversation }: { conversation: ConversationItem }) => {
      setConversations((prev) => {
        const existing = prev.find((item) => item.id === conversation.id);
        const updated = mergeConversationPresence(conversation, existing);
        const filtered = prev.filter((item) => item.id !== conversation.id);
        return sortConversations([updated, ...filtered]);
      });
    };

    const handleConversationRemoved = ({ conversationId }: { conversationId: string }) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeConvRef.current === conversationId) {
        latestActionsRef.current.setActiveConversationId(null);
        toast('You are no longer a member of that conversation.');
      }
    };

    const handleNotificationNew = ({ notification }: { notification: NotificationItem }) => {
      if (notificationIdsRef.current.has(notification.id)) return;
      notificationIdsRef.current.add(notification.id);
      setNotifications((prev) => [notification, ...prev.filter((n) => n.id !== notification.id)].slice(0, 30));
      if (!notification.isRead) setUnreadNotificationCount((count) => count + 1);
    };

    const handleRealtimeEvent = (eventName: string, payload: unknown) => {
      switch (eventName) {
        case 'auth:force_logout':
          handleForceLogout(payload as { reason: string });
          break;
        case 'message:new':
          handleMessageNew(payload as { message: ChatMessage });
          break;
        case 'conversation:activity':
          handleConversationActivity(
            payload as {
              conversationId: string;
              lastMessage: ChatMessage;
              lastMessageAt: string;
              senderId: string;
            }
          );
          break;
        case 'message:edited':
          handleMessageEdited(payload as { message: ChatMessage });
          break;
        case 'message:deleted':
          handleMessageDeleted(
            payload as { conversationId: string; messageId: string; deletedAt: string }
          );
          break;
        case 'message:receipts_updated':
          handleReceiptsUpdated(
            payload as {
              conversationId: string;
              userId: string;
              status: ReceiptStatus;
              messageIds: string[];
              timestamp: string;
            }
          );
          break;
        case 'conversation:created':
          handleConversationCreated(payload as { conversation: ConversationItem });
          break;
        case 'conversation:removed':
          handleConversationRemoved(payload as { conversationId: string });
          break;
        case 'conversation:updated':
        case 'conversation:members_changed':
        case 'conversation:member_left':
          void latestActionsRef.current.refreshConversations();
          break;
        case 'notification:new':
          handleNotificationNew(payload as { notification: NotificationItem });
          break;
        case 'notification:refresh':
          void latestActionsRef.current.refreshNotifications();
          break;
      }
    };

    pusher.connection.bind('connected', handleConnect);
    pusher.connection.bind('state_change', handleConnectionState);
    pusher.bind_global(handleRealtimeEvent);
    const subscribedChannelNames = [`private-user-${userId}`];
    const userChannel = pusher.subscribe(subscribedChannelNames[0]);
    userChannel.bind('pusher:subscription_error', () => {
      toast.error('Realtime authentication failed. Please sign in again.');
    });

    const presenceMemberChanged = (
      conversationId: string,
      member: { id: string; info: { onlineStatusVisible?: boolean } },
      isOnline: boolean
    ) => {
      if (member.info?.onlineStatusVisible === false) return;
      handlePresenceUpdate({
        userId: member.id,
        isOnline,
        lastSeenAt: new Date().toISOString(),
      });
      if (!isOnline) {
        setTypingByConversation((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] || []).filter(
            (typingUser) => typingUser.userId !== member.id
          ),
        }));
      }
    };

    const subscribedConversationIds = conversationChannelIds
      ? conversationChannelIds.split(',')
      : [];
    for (const conversationId of subscribedConversationIds) {
      const privateChannelName = `private-conversation-${conversationId}`;
      subscribedChannelNames.push(
        privateChannelName,
        `presence-conversation-${conversationId}`
      );
      const channel = pusher.subscribe(privateChannelName);
      channel.bind('pusher:subscription_error', () => {
        toast.error('Could not subscribe to a conversation’s realtime updates.');
      });

      const presenceChannel = pusher.subscribe(
        `presence-conversation-${conversationId}`
      ) as PresenceChannel;
      presenceChannelsRef.current.set(conversationId, presenceChannel);
      presenceChannel.bind('pusher:subscription_succeeded', (members: Members) => {
        members.each((member: { id: string; info: { onlineStatusVisible?: boolean } }) =>
          presenceMemberChanged(conversationId, member, true)
        );
      });
      presenceChannel.bind(
        'pusher:member_added',
        (member: { id: string; info: { onlineStatusVisible?: boolean } }) =>
          presenceMemberChanged(conversationId, member, true)
      );
      presenceChannel.bind(
        'pusher:member_removed',
        (member: { id: string; info: { onlineStatusVisible?: boolean } }) =>
          presenceMemberChanged(conversationId, member, false)
      );
      presenceChannel.bind('pusher:subscription_error', () => {
        toast.error('Could not subscribe to conversation presence updates.');
      });
    }

    if (pusher.connection.state === 'connected') {
      handleConnect();
    } else {
      handleConnectionState({ current: pusher.connection.state });
    }

    return () => {
      for (const binding of typingChannelBindingsRef.current.values()) {
        binding.channel.unbind('client-typing', binding.handler);
      }
      typingChannelBindingsRef.current.clear();
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
        typingTimeoutConversationRef.current = null;
      }
      if (reconnectingTimeoutRef.current) {
        clearTimeout(reconnectingTimeoutRef.current);
        reconnectingTimeoutRef.current = null;
      }
      presenceChannelsRef.current.clear();
      setTypingByConversation({});
      pusher.unbind_global(handleRealtimeEvent);
      pusher.connection.unbind('connected', handleConnect);
      pusher.connection.unbind('state_change', handleConnectionState);
      for (const channelName of subscribedChannelNames) {
        pusher.channel(channelName)?.unbind();
        pusher.unsubscribe(channelName);
      }
    };
  }, [userId, conversationChannelIds]);

  useEffect(() => {
    if (!activeConversationId || !userId) return;
    const channel = presenceChannelsRef.current.get(activeConversationId);
    if (!channel) return;

    const handler = (payload: unknown) =>
      handleClientTyping(activeConversationId, channel, payload);
    channel.bind('client-typing', handler);
    typingChannelBindingsRef.current.set(activeConversationId, { channel, handler });

    return () => {
      channel.unbind('client-typing', handler);
      typingChannelBindingsRef.current.delete(activeConversationId);
      clearTypingForConversation(activeConversationId);
    };
  }, [
    activeConversationId,
    userId,
    conversationChannelIds,
    handleClientTyping,
    clearTypingForConversation,
  ]);

  const sendMessageOptimistic = useCallback(
    async (params: {
      conversationId: string;
      content: string;
      type?: 'TEXT' | 'MEDIA' | 'VOICE';
      replyTo?: ChatMessage | null;
      stagedAttachments?: MessageAttachmentItem[];
      existingClientMessageId?: string;
    }): Promise<boolean> => {
      if (!user) return false;
      const clientMessageId =
        params.existingClientMessageId ||
        `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const attachments = params.stagedAttachments ?? [];
      if (attachments.length > 0) {
        pendingAttachmentsMemoryRef.current.set(clientMessageId, attachments);
      }
      const effectiveAttachments =
        pendingAttachmentsMemoryRef.current.get(clientMessageId) ?? attachments;

      const tempId = `optimistic_${clientMessageId}`;
      const nowIso = new Date().toISOString();

      const optimisticMessage: ChatMessage = {
        id: tempId,
        clientMessageId,
        conversationId: params.conversationId,
        senderId: user.id,
        sender: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          role: user.role,
        },
        replyTo: params.replyTo
          ? {
              id: params.replyTo.id,
              content: params.replyTo.content,
              type: params.replyTo.type,
              isDeleted: params.replyTo.isDeleted,
              sender: {
                id: params.replyTo.sender.id,
                username: params.replyTo.sender.username,
                displayName: params.replyTo.sender.displayName,
              },
            }
          : null,
        content: params.content,
        type: params.type || (effectiveAttachments.length > 0 ? 'MEDIA' : 'TEXT'),
        isEdited: false,
        editedAt: null,
        isDeleted: false,
        deletedAt: null,
        attachments: effectiveAttachments,
        receipts: [],
        createdAt: nowIso,
        updatedAt: nowIso,
        optimisticState: 'sending',
      };

      setMessagesByConversation((prev) => {
        const existing = (prev[params.conversationId] || []).filter(
          (m) => m.clientMessageId !== clientMessageId
        );
        return {
          ...prev,
          [params.conversationId]: [...existing, optimisticMessage],
        };
      });

      const payload = {
        clientMessageId,
        content: params.content,
        type: optimisticMessage.type,
        replyToId: params.replyTo?.id ?? null,
        attachmentIds: effectiveAttachments.map((a) => a.id),
      };

      try {
        const res = await apiClient.post<{
          success: boolean;
          data: { message: ChatMessage };
        }>(`/conversations/${params.conversationId}/messages`, payload);
        const savedMessage = res.data.data.message;

        pendingAttachmentsMemoryRef.current.delete(clientMessageId);

        setMessagesByConversation((prev) => ({
          ...prev,
          [params.conversationId]: mergeMessagesIdempotent(
            prev[params.conversationId] || [],
            [savedMessage!]
          ),
        }));

        return true;
      } catch (err) {
        const errMessage = extractApiError(err).message;
        setMessagesByConversation((prev) => ({
          ...prev,
          [params.conversationId]: (prev[params.conversationId] || []).map((m) =>
            m.clientMessageId === clientMessageId
              ? { ...m, optimisticState: 'failed', optimisticError: errMessage }
              : m
          ),
        }));
        toast.error(errMessage);
        return false;
      }
    },
    [user]
  );

  const retryFailedMessage = useCallback(
    async (conversationId: string, clientMessageId: string) => {
      const target = (messagesByConversation[conversationId] || []).find(
        (m) => m.clientMessageId === clientMessageId
      );
      if (!target) return;
      await sendMessageOptimistic({
        conversationId,
        content: target.content,
        type: target.type === 'SYSTEM' ? 'TEXT' : target.type,
        existingClientMessageId: clientMessageId,
      });
    },
    [messagesByConversation, sendMessageOptimistic]
  );

  const discardFailedMessage = useCallback((conversationId: string, clientMessageId: string) => {
    pendingAttachmentsMemoryRef.current.delete(clientMessageId);
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] || []).filter(
        (m) => m.clientMessageId !== clientMessageId
      ),
    }));
  }, []);

  const editMessage = useCallback(
    async (conversationId: string, messageId: string, content: string) => {
      const res = await apiClient.patch<{
        success: boolean;
        data: { message: ChatMessage };
      }>(`/conversations/${conversationId}/messages/${messageId}`, { content });
      const updated = res.data.data.message;
      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((m) =>
          m.id === messageId ? updated : m
        ),
      }));
    },
    []
  );

  const deleteMessage = useCallback(async (conversationId: string, messageId: string) => {
    await apiClient.delete(`/conversations/${conversationId}/messages/${messageId}`);
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] || []).map((m) =>
        m.id === messageId ? { ...m, isDeleted: true, content: '', attachments: [] } : m
      ),
    }));
  }, []);

  const emitTyping = useCallback((conversationId: string) => {
    if (!user || !connected) return;
    const channel = presenceChannelsRef.current.get(conversationId);
    if (!channel?.subscribed) return;

    const member = channel.members.get(user.id);
    if (!member || member.info?.typingIndicatorsEnabled === false) return;

    channel.trigger('client-typing', {
      userId: user.id,
      userName: user.displayName,
    });
  }, [user, connected]);

  return (
    <RealtimeContext.Provider
      value={{
        connected,
        reconnecting,
        conversations,
        conversationsLoading,
        activeConversationId,
        setActiveConversationId,
        messagesByConversation,
        paginationByConversation,
        typingByConversation,
        unreadNotificationCount,
        notifications,
        refreshConversations,
        refreshNotifications,
        loadMessages,
        sendMessageOptimistic,
        retryFailedMessage,
        discardFailedMessage,
        editMessage,
        deleteMessage,
        markConversationRead,
        emitTyping,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

export function useChatRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error('useChatRealtime must be used inside ChatRealtimeProvider');
  }
  return ctx;
}
