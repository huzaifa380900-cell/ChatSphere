import crypto from 'crypto';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import { AttachmentKind, AccessPolicy } from '@prisma/client';
import { env } from '../config/env.ts';
import { getPrisma } from '../db/prisma.ts';
import { Errors } from '../utils/errors.ts';
import { logger } from '../config/logger.ts';

if (env.cloudinary.enabled) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
}

interface AllowedMimeSpec {
  kind: AttachmentKind;
  resourceType: 'image' | 'video' | 'raw';
  extensions: string[];
  maxBytes: () => number;
  magicPrefixes?: string[];
}

const ALLOWED_MEDIA_SPECS: Record<string, AllowedMimeSpec> = {
  'image/jpeg': {
    kind: 'IMAGE',
    resourceType: 'image',
    extensions: ['jpg', 'jpeg'],
    maxBytes: () => env.uploads.maxImageBytes,
    magicPrefixes: ['ffd8ff'],
  },
  'image/png': {
    kind: 'IMAGE',
    resourceType: 'image',
    extensions: ['png'],
    maxBytes: () => env.uploads.maxImageBytes,
    magicPrefixes: ['89504e47'],
  },
  'image/webp': {
    kind: 'IMAGE',
    resourceType: 'image',
    extensions: ['webp'],
    maxBytes: () => env.uploads.maxImageBytes,
    magicPrefixes: ['52494646'],
  },
  'image/gif': {
    kind: 'IMAGE',
    resourceType: 'image',
    extensions: ['gif'],
    maxBytes: () => env.uploads.maxImageBytes,
    magicPrefixes: ['47494638'],
  },
  'video/mp4': {
    kind: 'VIDEO',
    resourceType: 'video',
    extensions: ['mp4', 'm4v'],
    maxBytes: () => env.uploads.maxVideoBytes,
  },
  'video/webm': {
    kind: 'VIDEO',
    resourceType: 'video',
    extensions: ['webm'],
    maxBytes: () => env.uploads.maxVideoBytes,
    magicPrefixes: ['1a45dfa3'],
  },
  'audio/webm': {
    kind: 'AUDIO',
    resourceType: 'video',
    extensions: ['webm'],
    maxBytes: () => env.uploads.maxAudioBytes,
    magicPrefixes: ['1a45dfa3'],
  },
  'audio/mpeg': {
    kind: 'AUDIO',
    resourceType: 'video',
    extensions: ['mp3'],
    maxBytes: () => env.uploads.maxAudioBytes,
    magicPrefixes: ['494433', 'fffb', 'fff3', 'fff2'],
  },
  'audio/wav': {
    kind: 'AUDIO',
    resourceType: 'video',
    extensions: ['wav'],
    maxBytes: () => env.uploads.maxAudioBytes,
    magicPrefixes: ['52494646'],
  },
  'audio/ogg': {
    kind: 'AUDIO',
    resourceType: 'video',
    extensions: ['ogg', 'oga'],
    maxBytes: () => env.uploads.maxAudioBytes,
    magicPrefixes: ['4f676753'],
  },
  'audio/mp4': {
    kind: 'AUDIO',
    resourceType: 'video',
    extensions: ['m4a', 'mp4'],
    maxBytes: () => env.uploads.maxAudioBytes,
  },
  'application/pdf': {
    kind: 'DOCUMENT',
    resourceType: 'raw',
    extensions: ['pdf'],
    maxBytes: () => env.uploads.maxDocumentBytes,
    magicPrefixes: ['25504446'],
  },
  'text/plain': {
    kind: 'DOCUMENT',
    resourceType: 'raw',
    extensions: ['txt', 'md', 'csv'],
    maxBytes: () => env.uploads.maxDocumentBytes,
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'DOCUMENT',
    resourceType: 'raw',
    extensions: ['docx'],
    maxBytes: () => env.uploads.maxDocumentBytes,
    magicPrefixes: ['504b0304'],
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'DOCUMENT',
    resourceType: 'raw',
    extensions: ['xlsx'],
    maxBytes: () => env.uploads.maxDocumentBytes,
    magicPrefixes: ['504b0304'],
  },
  'application/zip': {
    kind: 'DOCUMENT',
    resourceType: 'raw',
    extensions: ['zip'],
    maxBytes: () => env.uploads.maxDocumentBytes,
    magicPrefixes: ['504b0304'],
  },
};

export function validateUploadMetadata(input: {
  purpose: 'CHAT_ATTACHMENT' | 'AVATAR';
  filename: string;
  mimeType: string;
  fileSize: number;
  isVoiceNote?: boolean;
  magicBytesHex?: string;
}): {
  spec: AllowedMimeSpec;
  extension: string;
  attachmentKind: AttachmentKind;
  accessPolicy: AccessPolicy;
} {
  const normalizedMime = input.mimeType.split(';')[0].trim().toLowerCase();
  const spec = ALLOWED_MEDIA_SPECS[normalizedMime];
  if (!spec) {
    throw Errors.badRequest(
      `Unsupported file MIME type "${normalizedMime}".`,
      'INVALID_FILE_TYPE'
    );
  }

  if (input.purpose === 'AVATAR' && spec.kind !== 'IMAGE') {
    throw Errors.badRequest(
      'Profile avatars must be JPG, PNG, WEBP, or GIF images.',
      'INVALID_AVATAR_TYPE'
    );
  }

  const ext = path.extname(input.filename).replace(/^\./, '').toLowerCase();
  if (!ext || !spec.extensions.includes(ext)) {
    throw Errors.badRequest(
      `File extension ".${ext || 'none'}" does not match MIME type "${normalizedMime}".`,
      'EXTENSION_MISMATCH'
    );
  }

  const maxAllowed =
    input.purpose === 'AVATAR' ? Math.min(5 * 1024 * 1024, spec.maxBytes()) : spec.maxBytes();
  if (input.fileSize <= 0 || input.fileSize > maxAllowed) {
    throw Errors.badRequest(
      `File size exceeds the maximum allowed limit of ${(maxAllowed / (1024 * 1024)).toFixed(1)} MB.`,
      'FILE_TOO_LARGE'
    );
  }

  if (input.magicBytesHex && spec.magicPrefixes && spec.magicPrefixes.length > 0) {
    const cleanHex = input.magicBytesHex.toLowerCase().replace(/[^0-9a-f]/g, '');
    const matched = spec.magicPrefixes.some((prefix) => cleanHex.startsWith(prefix));
    if (!matched) {
      throw Errors.badRequest(
        'File binary signature does not match the declared file type.',
        'FILE_SIGNATURE_MISMATCH'
      );
    }
  }

  const attachmentKind: AttachmentKind =
    input.purpose === 'AVATAR'
      ? 'AVATAR'
      : input.isVoiceNote && spec.kind === 'AUDIO'
        ? 'VOICE'
        : spec.kind;

  const accessPolicy: AccessPolicy =
    input.purpose === 'AVATAR' ? 'PUBLIC_AVATAR' : 'AUTHENTICATED_CONVERSATION';

  return {
    spec,
    extension: ext,
    attachmentKind,
    accessPolicy,
  };
}

export function ensureCloudinaryConfigured() {
  if (!env.cloudinary.enabled) {
    throw Errors.serviceUnavailable(
      'Cloudinary cloud media storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in environment variables.',
      'CLOUDINARY_UNCONFIGURED'
    );
  }
}

export function createSignedUploadParams(input: {
  userId: string;
  purpose: 'CHAT_ATTACHMENT' | 'AVATAR';
  conversationId?: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  isVoiceNote?: boolean;
  magicBytesHex?: string;
}) {
  const validated = validateUploadMetadata(input);
  ensureCloudinaryConfigured();

  const timestamp = Math.floor(Date.now() / 1000);
  const uniqueSuffix = crypto.randomBytes(12).toString('hex');
  const folder =
    input.purpose === 'AVATAR'
      ? `chatsphere/avatars/${input.userId}`
      : `chatsphere/conversations/${input.conversationId}`;
  const publicId = `${folder}/${timestamp}_${uniqueSuffix}`;
  const deliveryType = validated.accessPolicy === 'PUBLIC_AVATAR' ? 'upload' : 'authenticated';

  const paramsToSign: Record<string, string | number> = {
    public_id: publicId,
    timestamp,
    type: deliveryType,
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, env.cloudinary.apiSecret);

  return {
    cloudName: env.cloudinary.cloudName,
    apiKey: env.cloudinary.apiKey,
    timestamp,
    signature,
    publicId,
    resourceType: validated.spec.resourceType,
    deliveryType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/${validated.spec.resourceType}/upload`,
    maxBytes: validated.spec.maxBytes(),
    attachmentKind: validated.attachmentKind,
    accessPolicy: validated.accessPolicy,
    expiresInSeconds: 120,
  };
}

export function verifyCloudinaryFinalizeSignature(params: {
  publicId: string;
  version: number;
  signature: string;
  expectedFolderPrefix: string;
}) {
  ensureCloudinaryConfigured();

  if (!params.publicId.startsWith(params.expectedFolderPrefix)) {
    throw Errors.forbidden('Upload public ID does not belong to the authorized namespace.');
  }

  const expectedSig = cloudinary.utils.api_sign_request(
    {
      public_id: params.publicId,
      version: params.version,
    },
    env.cloudinary.apiSecret
  );

  const bufA = Buffer.from(params.signature, 'utf8');
  const bufB = Buffer.from(expectedSig, 'utf8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    throw Errors.badRequest(
      'Invalid Cloudinary upload verification signature.',
      'INVALID_UPLOAD_SIGNATURE'
    );
  }
}

export function buildSignedDeliveryUrls(attachment: {
  cloudinaryPublicId: string;
  resourceType: string;
  attachmentKind: AttachmentKind;
  accessPolicy: AccessPolicy;
  fileExtension: string;
}): {
  url: string;
  thumbnailUrl?: string;
  expiresAt: string;
} {
  ensureCloudinaryConfigured();

  const expiresAtEpoch = Math.floor(Date.now() / 1000) + env.cloudinary.signedUrlTtlSeconds;
  const deliveryType = attachment.accessPolicy === 'PUBLIC_AVATAR' ? 'upload' : 'authenticated';

  const url = cloudinary.url(attachment.cloudinaryPublicId, {
    resource_type: attachment.resourceType as 'image' | 'video' | 'raw',
    type: deliveryType,
    sign_url: deliveryType !== 'upload',
    secure: true,
    format: attachment.resourceType === 'raw' ? undefined : attachment.fileExtension,
    expires_at: expiresAtEpoch,
  });

  let thumbnailUrl: string | undefined;
  if (attachment.attachmentKind === 'IMAGE' || attachment.attachmentKind === 'AVATAR') {
    thumbnailUrl = cloudinary.url(attachment.cloudinaryPublicId, {
      resource_type: 'image',
      type: deliveryType,
      sign_url: deliveryType !== 'upload',
      secure: true,
      transformation: [{ width: 480, height: 360, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
      expires_at: expiresAtEpoch,
    });
  } else if (attachment.attachmentKind === 'VIDEO') {
    thumbnailUrl = cloudinary.url(attachment.cloudinaryPublicId, {
      resource_type: 'video',
      type: deliveryType,
      sign_url: true,
      secure: true,
      format: 'jpg',
      transformation: [{ start_offset: '1', width: 480, height: 270, crop: 'fill', quality: 'auto' }],
      expires_at: expiresAtEpoch,
    });
  }

  return {
    url,
    thumbnailUrl,
    expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
  };
}

export async function destroyCloudinaryAsset(publicId: string, resourceType: string): Promise<boolean> {
  if (!env.cloudinary.enabled) return false;
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType as 'image' | 'video' | 'raw',
      type: 'authenticated',
      invalidate: true,
    });
    return true;
  } catch (err) {
    logger.warn('Failed to remove Cloudinary asset', {
      publicId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function cleanupOrphanedUploads(maxAgeMinutes = 60): Promise<number> {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  const staleUploads = await prisma.messageAttachment.findMany({
    where: {
      status: 'STAGED',
      messageId: null,
      uploadedAt: { lt: cutoff },
    },
    take: 50,
  });

  let cleaned = 0;
  for (const item of staleUploads) {
    await destroyCloudinaryAsset(item.cloudinaryPublicId, item.resourceType);
    await prisma.messageAttachment.update({
      where: { id: item.id },
      data: {
        status: 'ORPHANED',
        deletedAt: new Date(),
      },
    });
    cleaned++;
  }

  if (cleaned > 0) {
    logger.info('Cleaned up orphaned cloud uploads', { count: cleaned });
  }
  return cleaned;
}
