export type Role = 'USER' | 'ADMIN';
export type AccountStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';
export type ConversationType = 'DIRECT' | 'GROUP';
export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type MessageType = 'TEXT' | 'MEDIA' | 'VOICE' | 'SYSTEM';
export type AttachmentKind = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'VOICE' | 'DOCUMENT' | 'AVATAR';
export type ReceiptStatus = 'SENT' | 'DELIVERED' | 'READ';

export interface UserSettings {
  theme: 'dark' | 'light';
  emailNotifications: boolean;
  desktopNotifications: boolean;
  soundEnabled: boolean;
  readReceiptsEnabled: boolean;
  typingIndicatorsEnabled: boolean;
  onlineStatusVisible: boolean;
}

export interface UserPresence {
  isOnline: boolean;
  lastSeenAt: string | null;
  customStatus: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  role: Role;
  status: AccountStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  settings: UserSettings | null;
  presence: UserPresence | null;
}

export interface PublicUserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio?: string;
  role?: Role;
  presence?: UserPresence | null;
}

export interface MessageAttachmentItem {
  id: string;
  attachmentKind: AttachmentKind;
  resourceType?: string;
  mimeType: string;
  originalFilename: string;
  fileExtension: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  uploadedAt: string;
  url: string | null;
  thumbnailUrl: string | null;
  urlExpiresAt: string | null;
}

export interface MessageReceiptItem {
  userId: string;
  status: ReceiptStatus;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface ChatMessage {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    role: Role;
  };
  replyTo: {
    id: string;
    content: string;
    type: MessageType;
    isDeleted: boolean;
    sender: { id: string; username: string; displayName: string };
  } | null;
  content: string;
  type: MessageType;
  isEdited: boolean;
  editedAt: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
  attachments: MessageAttachmentItem[];
  receipts: MessageReceiptItem[];
  createdAt: string;
  updatedAt: string;
  optimisticState?: 'sending' | 'failed';
  optimisticError?: string;
}

export interface GroupMetadata {
  id: string;
  conversationId: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  onlyAdminsCanPost: boolean;
  onlyAdminsCanEditInfo: boolean;
  maxMembers: number;
}

export interface ConversationMemberItem {
  userId: string;
  role: MemberRole;
  joinedAt: string;
  user: PublicUserSummary;
}

export interface ConversationItem {
  id: string;
  type: ConversationType;
  lastMessageAt: string;
  createdAt: string;
  isPinned: boolean;
  isMuted: boolean;
  myRole: MemberRole;
  unreadCount: number;
  groupMetadata: GroupMetadata | null;
  directPeer: PublicUserSummary | null;
  members: ConversationMemberItem[];
  lastMessage: ChatMessage | null;
}

export interface NotificationItem {
  id: string;
  userId: string;
  actorId: string | null;
  conversationId: string | null;
  messageId: string | null;
  type: 'NEW_MESSAGE' | 'MENTION' | 'GROUP_INVITE' | 'ROLE_CHANGED' | 'SYSTEM_SECURITY' | 'MODERATION';
  title: string;
  body: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  actor?: PublicUserSummary | null;
}

export interface ActiveSessionItem {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}
