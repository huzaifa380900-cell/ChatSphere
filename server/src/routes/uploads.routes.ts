import { Router, Response, NextFunction } from 'express';
import { getPrisma } from '../db/prisma.ts';
import {
  AuthRequest,
  requireAuth,
  requireCsrf,
  uploadRateLimiter,
} from '../middleware/security.ts';
import {
  finalizeUploadSchema,
  signUploadRequestSchema,
} from '../validation/schemas.ts';
import {
  buildSignedDeliveryUrls,
  createSignedUploadParams,
  destroyCloudinaryAsset,
  validateUploadMetadata,
  verifyCloudinaryFinalizeSignature,
} from '../services/cloudinary.service.ts';
import { assertActiveMembership } from '../services/message.service.ts';
import { Errors } from '../utils/errors.ts';

export const uploadsRouter = Router();

uploadsRouter.use(requireAuth);

// 1. Generate short-lived server-signed Cloudinary upload parameters
uploadsRouter.post(
  '/sign',
  uploadRateLimiter,
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const input = signUploadRequestSchema.parse(req.body);
      const userId = req.authUser!.id;

      if (input.purpose === 'CHAT_ATTACHMENT') {
        if (!input.conversationId) {
          throw Errors.badRequest('conversationId is required for chat attachments.');
        }
        await assertActiveMembership(input.conversationId, userId);
      }

      const signed = createSignedUploadParams({
        userId,
        purpose: input.purpose,
        conversationId: input.conversationId,
        filename: input.filename,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        isVoiceNote: input.isVoiceNote,
        magicBytesHex: input.magicBytesHex,
      });

      res.json({
        success: true,
        data: signed,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 2. Finalize uploaded Cloudinary asset & stage metadata in PostgreSQL
uploadsRouter.post(
  '/finalize',
  uploadRateLimiter,
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const input = finalizeUploadSchema.parse(req.body);
      const userId = req.authUser!.id;

      if (input.purpose === 'CHAT_ATTACHMENT') {
        if (!input.conversationId) {
          throw Errors.badRequest('conversationId is required for chat attachments.');
        }
        await assertActiveMembership(input.conversationId, userId);
      }

      const validated = validateUploadMetadata({
        purpose: input.purpose,
        filename: input.originalFilename,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        isVoiceNote: input.isVoiceNote,
      });

      const expectedPrefix =
        input.purpose === 'AVATAR'
          ? `chatsphere/avatars/${userId}/`
          : `chatsphere/conversations/${input.conversationId}/`;

      verifyCloudinaryFinalizeSignature({
        publicId: input.cloudinaryPublicId,
        version: input.cloudinaryVersion,
        signature: input.cloudinarySignature,
        expectedFolderPrefix: expectedPrefix,
      });

      const prisma = getPrisma();

      try {
        const record = await prisma.messageAttachment.upsert({
          where: { cloudinaryPublicId: input.cloudinaryPublicId },
          update: {},
          create: {
            ownerId: userId,
            conversationId: input.conversationId ?? null,
            cloudinaryPublicId: input.cloudinaryPublicId,
            resourceType: validated.spec.resourceType,
            attachmentKind: validated.attachmentKind,
            mimeType: input.mimeType.split(';')[0].trim().toLowerCase(),
            originalFilename: input.originalFilename,
            fileExtension: validated.extension,
            fileSize: input.fileSize,
            accessPolicy: validated.accessPolicy,
            width: input.width ?? null,
            height: input.height ?? null,
            durationSeconds: input.durationSeconds ?? null,
            status: 'STAGED',
          },
        });

        const delivery = buildSignedDeliveryUrls(record);

        res.status(201).json({
          success: true,
          data: {
            attachment: {
              id: record.id,
              attachmentKind: record.attachmentKind,
              mimeType: record.mimeType,
              originalFilename: record.originalFilename,
              fileExtension: record.fileExtension,
              fileSize: record.fileSize,
              width: record.width,
              height: record.height,
              durationSeconds: record.durationSeconds,
              status: record.status,
              url: delivery.url,
              thumbnailUrl: delivery.thumbnailUrl ?? null,
              urlExpiresAt: delivery.expiresAt,
            },
          },
        });
      } catch (dbErr) {
        // Cloud upload succeeded but DB write failed -> immediately clean up remote Cloudinary asset
        await destroyCloudinaryAsset(input.cloudinaryPublicId, validated.spec.resourceType);
        throw dbErr;
      }
    } catch (err) {
      next(err);
    }
  }
);

// 3. Cancel / discard a staged upload before sending message
uploadsRouter.delete(
  '/staged/:id',
  requireCsrf,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const attachmentId = String(req.params.id);
      const prisma = getPrisma();
      const att = await prisma.messageAttachment.findUnique({ where: { id: attachmentId } });

      if (!att || att.ownerId !== req.authUser!.id) {
        throw Errors.notFound('Staged upload not found.');
      }

      if (att.status !== 'STAGED') {
        throw Errors.badRequest('Only unattached staged uploads can be cancelled directly.');
      }

      await destroyCloudinaryAsset(att.cloudinaryPublicId, att.resourceType);
      await prisma.messageAttachment.update({
        where: { id: att.id },
        data: { status: 'DELETED', deletedAt: new Date() },
      });

      res.json({ success: true, data: { cancelledId: att.id } });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Authorized signed URL refresh for private conversation attachments
uploadsRouter.get(
  '/attachments/:id/url',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const attachmentId = String(req.params.id);
      const userId = req.authUser!.id;
      const isGlobalAdmin = req.authUser!.role === 'ADMIN';
      const prisma = getPrisma();

      const att = await prisma.messageAttachment.findUnique({
        where: { id: attachmentId },
      });

      if (!att || att.status === 'DELETED' || att.status === 'ORPHANED') {
        throw Errors.notFound('Attachment is unavailable or has been deleted.');
      }

      if (att.accessPolicy === 'AUTHENTICATED_CONVERSATION') {
        if (!att.conversationId) {
          throw Errors.forbidden('Missing conversation scope for attachment.');
        }
        if (!isGlobalAdmin && att.ownerId !== userId) {
          await assertActiveMembership(att.conversationId, userId);
        } else if (!isGlobalAdmin && att.ownerId === userId) {
          // Even original uploader loses access if removed from the conversation
          await assertActiveMembership(att.conversationId, userId);
        }
      } else if (att.accessPolicy === 'PRIVATE_OWNER') {
        if (att.ownerId !== userId && !isGlobalAdmin) {
          throw Errors.forbidden('You do not have permission to access this private file.');
        }
      }

      const delivery = buildSignedDeliveryUrls(att);

      res.json({
        success: true,
        data: {
          attachmentId: att.id,
          url: delivery.url,
          thumbnailUrl: delivery.thumbnailUrl ?? null,
          expiresAt: delivery.expiresAt,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 5. List shared media & documents inside an authorized conversation
uploadsRouter.get(
  '/conversations/:conversationId/media',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const conversationId = String(req.params.conversationId);
      await assertActiveMembership(conversationId, req.authUser!.id);

      const prisma = getPrisma();
      const items = await prisma.messageAttachment.findMany({
        where: {
          conversationId,
          status: 'ATTACHED',
          message: { isDeleted: false },
        },
        orderBy: { uploadedAt: 'desc' },
        take: 60,
      });

      const formatted = items.map((att) => {
        let delivery: { url: string | null; thumbnailUrl?: string; expiresAt?: string } = {
          url: null,
        };
        try {
          delivery = buildSignedDeliveryUrls(att);
        } catch {
          delivery = { url: null };
        }
        return {
          id: att.id,
          attachmentKind: att.attachmentKind,
          mimeType: att.mimeType,
          originalFilename: att.originalFilename,
          fileExtension: att.fileExtension,
          fileSize: att.fileSize,
          width: att.width,
          height: att.height,
          durationSeconds: att.durationSeconds,
          uploadedAt: att.uploadedAt,
          url: delivery.url,
          thumbnailUrl: delivery.thumbnailUrl ?? null,
          urlExpiresAt: delivery.expiresAt ?? null,
        };
      });

      res.json({ success: true, data: { media: formatted } });
    } catch (err) {
      next(err);
    }
  }
);
