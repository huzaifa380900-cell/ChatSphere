'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext.tsx';
import { apiClient, extractApiError } from '../lib/api.ts';
import type {
  ChatMessage,
  ConversationItem,
  MessageAttachmentItem,
  NotificationItem,
  ReceiptStatus,
} from '../types/models.ts';

interface TypingUser {
  userId: string;
  displayName: string;
  expiresAt: number;
}

interface ChatSocketContextValue {
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
  emitTyping: (conversationId: string, isTyping: boolean) => void;
}

const ChatSocketContext = createContext<ChatSocketContextValue | null>(null);

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

export function ChatSocketProvider({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const socketRef = useRef<Socket | null>(null);
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

  const setActiveConversationId = useCallback((id: string | null) => {
    activeConvRef.current = id;
    setActiveConversationIdState(id);
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!user) return;
    setConversationsLoading(true);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { conversations: ConversationItem[] };
      }>('/conversations');
      setConversations(sortConversations(res.data.data.conversations));
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
        if (socketRef.current?.connected) {
          socketRef.current.emit('conversation:read', { conversationId });
        } else {
          await apiClient.post(`/conversations/${conversationId}/read`);
        }
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

  // Clean up expired typing indicators every 2s
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setTypingByConversation((prev) => {
        let changed = false;
        const next: Record<string, TypingUser[]> = {};
        for (const [cid, list] of Object.entries(prev)) {
          const filtered = list.filter((u) => u.expiresAt > now);
          if (filtered.length !== list.length) changed = true;
          if (filtered.length > 0) next[cid] = filtered;
        }
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Connect and manage single authenticated Socket.IO subscription lifecycle
  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setConnected(false);
      setConversations([]);
      setMessagesByConversation({});
      setNotifications([]);
      notificationIdsRef.current.clear();
      setUnreadNotificationCount(0);
      return;
    }

    void refreshConversations();
    void refreshNotifications();

    // Socket.IO connects directly to the backend origin (WebSocket upgrades are
    // not proxied through the Next.js rewrite), falling back to the current
    // origin when the backend is served from the same host.
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin;
    const socket = io(socketUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 6000,
    });

    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      setReconnecting(false);
      void refreshNotifications();

      const currentActive = activeConvRef.current;
      socket.emit(
        'sync:reconnect',
        {
          conversationId: currentActive ?? undefined,
          since: lastSyncedIsoRef.current,
        },
        (resp?: {
          success: boolean;
          data?: { syncedAt: string; missedMessages: ChatMessage[] };
        }) => {
          if (resp?.success && resp.data) {
            lastSyncedIsoRef.current = resp.data.syncedAt;
            if (currentActive && resp.data.missedMessages.length > 0) {
              setMessagesByConversation((prev) => ({
                ...prev,
                [currentActive]: mergeMessagesIdempotent(
                  prev[currentActive] || [],
                  resp.data!.missedMessages
                ),
              }));
            }
          }
          void refreshConversations();
        }
      );
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    const handleReconnectAttempt = () => {
      setReconnecting(true);
    };

    const handleConnectError = async (err: Error) => {
      if (err.message === 'AUTH_INVALID' || err.message === 'AUTH_REQUIRED') {
        try {
          await apiClient.post('/auth/refresh');
          socket.connect();
        } catch {
          // Session truly expired
        }
      }
    };

    const handleForceLogout = ({ reason }: { reason: string }) => {
      toast.error(
        reason === 'account_suspended'
          ? 'Your account has been suspended by an administrator.'
          : 'Your session was signed out.'
      );
      void logout();
    };

    const handleMessageNew = ({ message }: { message: ChatMessage }) => {
      lastSyncedIsoRef.current = new Date().toISOString();
      setMessagesByConversation((prev) => ({
        ...prev,
        [message.conversationId]: mergeMessagesIdempotent(
          prev[message.conversationId] || [],
          [message]
        ),
      }));

      if (activeConvRef.current === message.conversationId && message.senderId !== user.id) {
        void markConversationRead(message.conversationId);
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
          void refreshConversations();
          return prev;
        }
        const updated = prev.map((c) => {
          if (c.id !== conversationId) return c;
          const isViewing = activeConvRef.current === conversationId;
          const nextUnread =
            senderId === user.id || isViewing ? 0 : (c.unreadCount || 0) + 1;
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
      void refreshConversations();
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

    const handleTypingUpdate = ({
      conversationId,
      userId: typingUserId,
      displayName,
      isTyping,
    }: {
      conversationId: string;
      userId: string;
      displayName: string;
      isTyping: boolean;
    }) => {
      if (typingUserId === user.id) return;
      setTypingByConversation((prev) => {
        const existing = (prev[conversationId] || []).filter((t) => t.userId !== typingUserId);
        if (!isTyping) {
          return { ...prev, [conversationId]: existing };
        }
        return {
          ...prev,
          [conversationId]: [
            ...existing,
            { userId: typingUserId, displayName, expiresAt: Date.now() + 4500 },
          ],
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
        const filtered = prev.filter((c) => c.id !== conversation.id);
        return sortConversations([conversation, ...filtered]);
      });
    };

    const handleConversationRemoved = ({ conversationId }: { conversationId: string }) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeConvRef.current === conversationId) {
        setActiveConversationId(null);
        toast('You are no longer a member of that conversation.');
      }
    };

    const handleNotificationNew = ({ notification }: { notification: NotificationItem }) => {
      if (notificationIdsRef.current.has(notification.id)) return;
      notificationIdsRef.current.add(notification.id);
      setNotifications((prev) => [notification, ...prev.filter((n) => n.id !== notification.id)].slice(0, 30));
      if (!notification.isRead) setUnreadNotificationCount((count) => count + 1);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('connect_error', handleConnectError);
    socket.on('auth:force_logout', handleForceLogout);
    socket.on('message:new', handleMessageNew);
    socket.on('conversation:activity', handleConversationActivity);
    socket.on('message:edited', handleMessageEdited);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('message:receipts_updated', handleReceiptsUpdated);
    socket.on('typing:update', handleTypingUpdate);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('conversation:created', handleConversationCreated);
    socket.on('conversation:removed', handleConversationRemoved);
    socket.on('conversation:updated', refreshConversations);
    socket.on('conversation:members_changed', refreshConversations);
    socket.on('conversation:member_left', refreshConversations);
    socket.on('notification:new', handleNotificationNew);

    return () => {
      socket.removeAllListeners();
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, logout, refreshConversations, refreshNotifications, markConversationRead, setActiveConversationId]);

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
        let savedMessage: ChatMessage | null = null;

        if (socketRef.current?.connected) {
          const ack = await new Promise<{
            success: boolean;
            data?: { message: ChatMessage };
            error?: { message: string };
          }>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Socket acknowledgment timeout')), 20000);
            socketRef.current!.emit(
              'message:send',
              { conversationId: params.conversationId, ...payload },
              (response: {
                success: boolean;
                data?: { message: ChatMessage };
                error?: { message: string };
              }) => {
                clearTimeout(timeout);
                resolve(response);
              }
            );
          });

          if (!ack.success || !ack.data?.message) {
            throw new Error(ack.error?.message || 'Message delivery failed.');
          }
          savedMessage = ack.data.message;
        } else {
          // Reliable HTTP REST fallback using the exact same idempotency clientMessageId
          const res = await apiClient.post<{
            success: boolean;
            data: { message: ChatMessage };
          }>(`/conversations/${params.conversationId}/messages`, payload);
          savedMessage = res.data.data.message;
        }

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

  const emitTyping = useCallback((conversationId: string, isTyping: boolean) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit(isTyping ? 'typing:start' : 'typing:stop', { conversationId });
  }, []);

  return (
    <ChatSocketContext.Provider
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
    </ChatSocketContext.Provider>
  );
}

export function useChatSocket() {
  const ctx = useContext(ChatSocketContext);
  if (!ctx) {
    throw new Error('useChatSocket must be used inside ChatSocketProvider');
  }
  return ctx;
}
