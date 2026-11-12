import { z } from 'zod';

const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .max(128, 'Password cannot exceed 128 characters.')
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter.')
  .regex(/[a-z]/, 'Password must include at least one lowercase letter.')
  .regex(/[0-9]/, 'Password must include at least one number.');

export const registerSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254).transform((v) => v.toLowerCase()),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters.')
    .max(30, 'Username cannot exceed 30 characters.')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores.')
    .transform((v) => v.toLowerCase()),
  displayName: z.string().trim().min(2, 'Display name must be at least 2 characters.').max(60),
  password: passwordRule,
});

export const verifyEmailOtpSchema = z.object({
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  otp: z.string().trim().regex(/^\d{6}$/, 'Verification code must be 6 digits.'),
});

export const resendOtpSchema = z.object({
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Password is required.').max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(254).transform((v) => v.toLowerCase()),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(32).max(256),
  newPassword: passwordRule,
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  bio: z.string().trim().max(300).optional(),
  customStatus: z.string().trim().max(80).nullable().optional(),
  avatarAttachmentId: z.string().trim().min(1).max(128).nullable().optional(),
});

export const updateSettingsSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  emailNotifications: z.boolean().optional(),
  desktopNotifications: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  readReceiptsEnabled: z.boolean().optional(),
  typingIndicatorsEnabled: z.boolean().optional(),
  onlineStatusVisible: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordRule,
});

export const createDirectConversationSchema = z.object({
  targetUserId: z.string().trim().min(1).max(128),
});

export const createGroupConversationSchema = z.object({
  name: z.string().trim().min(2, 'Group name must be at least 2 characters.').max(80),
  description: z.string().trim().max(400).optional().default(''),
  memberIds: z.array(z.string().trim().min(1).max(128)).min(1, 'Select at least one member.').max(249),
  onlyAdminsCanPost: z.boolean().optional().default(false),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(400).optional(),
  onlyAdminsCanPost: z.boolean().optional(),
  onlyAdminsCanEditInfo: z.boolean().optional(),
});

export const manageGroupMembersSchema = z.object({
  userIds: z.array(z.string().trim().min(1).max(128)).min(1).max(50),
});

export const updateConversationPrefSchema = z.object({
  isPinned: z.boolean().optional(),
  isMuted: z.boolean().optional(),
});

export const sendMessageSchema = z
  .object({
    clientMessageId: z.string().trim().min(8).max(128),
    content: z.string().max(8000).default(''),
    type: z.enum(['TEXT', 'MEDIA', 'VOICE']).default('TEXT'),
    replyToId: z.string().trim().min(1).max(128).nullable().optional(),
    attachmentIds: z.array(z.string().trim().min(1).max(128)).max(10).default([]),
  })
  .refine((data) => data.content.trim().length > 0 || data.attachmentIds.length > 0, {
    message: 'Message must contain text or at least one attachment.',
  });

export const editMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message content cannot be empty.').max(8000),
});

export const signUploadRequestSchema = z.object({
  purpose: z.enum(['CHAT_ATTACHMENT', 'AVATAR']),
  conversationId: z.string().trim().min(1).max(128).optional(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(120),
  fileSize: z.number().int().positive(),
  isVoiceNote: z.boolean().optional().default(false),
  magicBytesHex: z.string().trim().max(64).optional(),
});

export const finalizeUploadSchema = z.object({
  purpose: z.enum(['CHAT_ATTACHMENT', 'AVATAR']),
  conversationId: z.string().trim().min(1).max(128).optional(),
  cloudinaryPublicId: z.string().trim().min(3).max(500),
  cloudinarySignature: z.string().trim().min(16).max(256),
  cloudinaryVersion: z.number().int().positive(),
  resourceType: z.enum(['image', 'video', 'raw']),
  mimeType: z.string().trim().min(3).max(120),
  originalFilename: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  isVoiceNote: z.boolean().optional().default(false),
});

export const createReportSchema = z
  .object({
    targetUserId: z.string().trim().min(1).max(128).optional(),
    conversationId: z.string().trim().min(1).max(128).optional(),
    messageId: z.string().trim().min(1).max(128).optional(),
    reason: z.enum(['SPAM', 'HARASSMENT', 'MALWARE', 'IMPERSONATION', 'ILLEGAL_CONTENT', 'OTHER']),
    details: z.string().trim().min(10, 'Provide at least 10 characters explaining the report.').max(1500),
  })
  .refine((d) => Boolean(d.targetUserId || d.messageId || d.conversationId), {
    message: 'Report must reference a user, message, or conversation.',
  });

export const adminUpdateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().max(500).optional(),
});

export const adminResolveReportSchema = z.object({
  status: z.enum(['IN_REVIEW', 'RESOLVED', 'DISMISSED']),
  resolutionNotes: z.string().trim().min(3).max(1000),
  deleteReportedMessage: z.boolean().optional().default(false),
  suspendTargetUser: z.boolean().optional().default(false),
});
