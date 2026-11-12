import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCsrf, uploadRateLimiter } from '../middleware/security.ts';
import { getAIProviderStatus, runAI } from '../services/ai/router.ts';
import { aiConfig } from '../config/ai.ts';
import { AppError } from '../utils/errors.ts';

export const aiRouter = Router();
aiRouter.use(requireAuth);
aiRouter.get('/status', async (_req, res, next) => {
  try {
    res.json({
      success: true,
      data: { allowPaidUsage: aiConfig.allowPaidUsage, providers: await getAIProviderStatus() },
    });
  } catch (error) {
    next(error);
  }
});

const writerSchema = z.object({
  instruction: z.string().trim().min(1).max(2000),
  text: z.string().max(12000).default(''),
  tone: z.enum(['professional', 'friendly', 'casual', 'romantic', 'funny', 'formal']).default('friendly'),
  action: z.enum(['write', 'rewrite', 'grammar', 'shorten', 'expand', 'translate']).default('write'),
});

aiRouter.post('/text', requireCsrf, uploadRateLimiter, async (req, res, next) => {
  try {
    const input = writerSchema.parse(req.body);
    const { result, provider, model } = await runAI('text', async (ai, selectedModel) => {
      const response = await ai.generateText({
        model: selectedModel,
        temperature: 0.65,
        maxTokens: 700,
        messages: [
          { role: 'system', content: "You write messages for the user's chat. Return only the finished message. Never add an explanation, heading, or quotation marks unless requested." },
          { role: 'user', content: `Task: ${input.action}\nTone: ${input.tone}\nInstruction: ${input.instruction}\nOriginal text: ${input.text || '(no original text)'}` },
        ],
      });
      if (!response.choices[0]?.message.content?.trim()) {
        throw new AppError(502, 'AI_EMPTY_RESPONSE', 'The AI provider returned an empty message.');
      }
      return response;
    });
    const text = result.choices[0]?.message.content?.trim();
    if (!text) throw new AppError(502, 'AI_EMPTY_RESPONSE', 'The AI provider returned an empty message. Try again.');
    res.json({ success: true, data: { text, provider, model } });
  } catch (error) { next(error); }
});

function getImageSource(image: { b64Json?: string; mimeType?: string; url?: string }): string | undefined {
  const detectMimeType = (bytes: Buffer) => bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    ? 'image/jpeg'
    : bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      ? 'image/png'
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        ? 'image/webp'
        : undefined;

  if (image.b64Json) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image.b64Json)) return undefined;
    const bytes = Buffer.from(image.b64Json, 'base64');
    const mimeType = detectMimeType(bytes);
    const providedMimeType = image.mimeType?.split(';')[0].trim().toLowerCase();
    if (!bytes.length || !mimeType || (providedMimeType && providedMimeType !== mimeType)) return undefined;
    return `data:${mimeType};base64,${image.b64Json}`;
  }

  if (image.url?.startsWith('data:')) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image.url);
    if (!match) return undefined;
    const mimeType = detectMimeType(Buffer.from(match[2], 'base64'));
    if (mimeType !== match[1].toLowerCase()) return undefined;
    return `data:${mimeType};base64,${match[2]}`;
  }

  if (image.url) {
    try {
      const url = new URL(image.url);
      if (url.protocol === 'https:') return url.toString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

aiRouter.post('/image', requireCsrf, uploadRateLimiter, async (req, res, next) => {
  try {
    const input = z.object({
      prompt: z.string().trim().min(3).max(1500),
      style: z.enum(['cartoon', 'anime', '3d', 'realistic']).default('cartoon'),
    }).parse(req.body);
    const prompt = `Create a ${input.style} style chat sticker or avatar, centered subject, polished expressive design, clean simple background. Request: ${input.prompt}`;
    const { result: image, provider, model } = await runAI('image', async (ai, selectedModel) => {
      if (!ai.generateImage) throw new AppError(400, 'UNSUPPORTED_CAPABILITY', 'This provider does not support image generation.');
      const response = await ai.generateImage({ model: selectedModel, prompt, n: 1, responseFormat: 'b64_json' });
      const source = response.data[0] && getImageSource(response.data[0]);
      if (!source) throw new AppError(502, 'AI_INVALID_IMAGE', 'The image provider returned invalid image data.');
      return source;
    });
    res.json({ success: true, data: { image, provider, model } });
  } catch (error) { next(error); }
});

const acceptedAudioTypes = new Set([
  'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4',
  'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp3',
]);
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const transcriptionSchema = z.object({
  audio: z.string().min(16).max(Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 8),
  mimeType: z.string().max(100),
  language: z.string().trim().max(20).optional(),
});

function audioSignatureMatches(bytes: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'audio/wav':
    case 'audio/x-wav': return bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
    case 'audio/ogg': return bytes.toString('ascii', 0, 4) === 'OggS';
    case 'audio/flac': return bytes.toString('ascii', 0, 4) === 'fLaC';
    case 'audio/mp4': return bytes.length > 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
    case 'audio/webm': return bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case 'audio/aac': return bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
    case 'audio/mpeg':
    case 'audio/mp3': return bytes.toString('ascii', 0, 3) === 'ID3' || (bytes.length > 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    default: return false;
  }
}

aiRouter.post('/transcribe', requireCsrf, uploadRateLimiter, async (req, res, next) => {
  try {
    const input = transcriptionSchema.parse(req.body);
    const mimeType = input.mimeType.toLowerCase().split(';')[0].trim();
    if (!acceptedAudioTypes.has(mimeType)) {
      throw new AppError(415, 'UNSUPPORTED_AUDIO_FORMAT', 'Supported audio types: WebM, WAV, MP3, MP4, OGG, FLAC, and AAC.');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.audio)) throw new AppError(400, 'INVALID_AUDIO', 'The uploaded audio could not be read.');
    const bytes = Buffer.from(input.audio, 'base64');
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new AppError(413, 'AUDIO_TOO_LARGE', 'Audio files must be 10 MB or smaller.');
    if (!audioSignatureMatches(bytes, mimeType)) throw new AppError(415, 'AUDIO_MIME_MISMATCH', 'The audio contents do not match the selected file type.');
    const { result, provider, model } = await runAI('audio', (ai, selectedModel) => {
      if (!ai.transcribeAudio) throw new AppError(400, 'UNSUPPORTED_CAPABILITY', 'This provider does not support speech transcription.');
      return ai.transcribeAudio({ model: selectedModel, audio: input.audio, mimeType, language: input.language });
    });
    res.json({ success: true, data: { text: result.text, provider, model } });
  } catch (error) { next(error); }
});
