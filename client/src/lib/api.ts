import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { MessageAttachmentItem } from '../types/models.ts';

// Relative by default so requests stay same-origin and the Next.js rewrite
// proxies them to the Express backend (no CORS preflight, httpOnly cookies
// flow through untouched). Override with NEXT_PUBLIC_API_URL for split
// frontend/backend deployments.
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || '/api').replace(/\/+$/, '');

let csrfTokenMemory: string | null = null;
let csrfPromise: Promise<string> | null = null;
let refreshPromise: Promise<boolean> | null = null;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function ensureCsrfToken(): Promise<string> {
  if (csrfTokenMemory) return csrfTokenMemory;
  if (csrfPromise) return csrfPromise;

  csrfPromise = axios
    .get<{ success: boolean; data: { csrfToken: string } }>(`${API_BASE_URL}/auth/csrf`, {
      withCredentials: true,
    })
    .then((res) => {
      csrfTokenMemory = res.data.data.csrfToken;
      return csrfTokenMemory;
    })
    .finally(() => {
      csrfPromise = null;
    });

  return csrfPromise;
}

export function resetCsrfTokenCache() {
  csrfTokenMemory = null;
}

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const method = (config.method || 'get').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = await ensureCsrfToken();
    config.headers.set('X-CSRF-Token', token);
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: { code?: string; message?: string; details?: unknown } }>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean; _csrfRetried?: boolean }) | undefined;
    const errCode = error.response?.data?.error?.code;

    if (original && errCode === 'CSRF_INVALID' && !original._csrfRetried) {
      original._csrfRetried = true;
      resetCsrfTokenCache();
      const fresh = await ensureCsrfToken();
      original.headers.set('X-CSRF-Token', fresh);
      return apiClient(original);
    }

    if (
      original &&
      error.response?.status === 401 &&
      errCode === 'TOKEN_EXPIRED' &&
      !original._retried &&
      !original.url?.includes('/auth/refresh') &&
      !original.url?.includes('/auth/login')
    ) {
      original._retried = true;
      if (!refreshPromise) {
        refreshPromise = axios
          .post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true })
          .then(() => true)
          .catch(() => false)
          .finally(() => {
            refreshPromise = null;
          });
      }
      const ok = await refreshPromise;
      if (ok) {
        return apiClient(original);
      }
    }

    return Promise.reject(error);
  }
);

export function extractApiError(err: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (axios.isAxiosError(err)) {
    const apiErr = err.response?.data?.error;
    if (apiErr && typeof apiErr.message === 'string') {
      return {
        code: apiErr.code || 'API_ERROR',
        message: apiErr.message,
        details: apiErr.details,
      };
    }
    if (err.code === 'ERR_CANCELED') {
      return { code: 'CANCELLED', message: 'Request cancelled.' };
    }
  }
  if (err instanceof Error) {
    return { code: 'CLIENT_ERROR', message: err.message };
  }
  return { code: 'UNKNOWN_ERROR', message: 'An unexpected network error occurred.' };
}

async function readMagicBytesHex(file: File): Promise<string> {
  const slice = file.slice(0, 8);
  const buffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface DirectCloudinaryUploadOptions {
  file: File;
  purpose: 'CHAT_ATTACHMENT' | 'AVATAR';
  conversationId?: string;
  isVoiceNote?: boolean;
  durationSeconds?: number;
  onProgress?: (percent: number) => void;
  abortSignal?: AbortSignal;
}

export async function uploadMediaToCloudinary(
  options: DirectCloudinaryUploadOptions
): Promise<MessageAttachmentItem> {
  const magicBytesHex = await readMagicBytesHex(options.file);

  const signRes = await apiClient.post<{
    success: boolean;
    data: {
      cloudName: string;
      apiKey: string;
      timestamp: number;
      signature: string;
      publicId: string;
      resourceType: 'image' | 'video' | 'raw';
      deliveryType: string;
      uploadUrl: string;
    };
  }>(
    '/uploads/sign',
    {
      purpose: options.purpose,
      conversationId: options.conversationId,
      filename: options.file.name,
      mimeType: options.file.type || 'application/octet-stream',
      fileSize: options.file.size,
      isVoiceNote: Boolean(options.isVoiceNote),
      magicBytesHex,
    },
    { signal: options.abortSignal }
  );

  const signed = signRes.data.data;

  // Direct browser-to-Cloudinary upload using short-lived server signature
  const cloudResponse = await new Promise<{
    public_id: string;
    version: number;
    signature: string;
    resource_type: 'image' | 'video' | 'raw';
    bytes: number;
    width?: number;
    height?: number;
    duration?: number;
  }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', options.file);
    formData.append('api_key', signed.apiKey);
    formData.append('timestamp', String(signed.timestamp));
    formData.append('signature', signed.signature);
    formData.append('public_id', signed.publicId);
    formData.append('type', signed.deliveryType);

    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        reject(new DOMException('Upload cancelled by user', 'AbortError'));
        return;
      }
      options.abortSignal.addEventListener(
        'abort',
        () => {
          xhr.abort();
          reject(new DOMException('Upload cancelled by user', 'AbortError'));
        },
        { once: true }
      );
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && options.onProgress) {
        options.onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid upload response from Cloudinary.'));
        }
      } else {
        try {
          const parsedErr = JSON.parse(xhr.responseText);
          reject(new Error(parsedErr?.error?.message || 'Cloudinary rejected the file upload.'));
        } catch {
          reject(new Error(`Cloud upload failed with status ${xhr.status}.`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error while uploading media to Cloudinary.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled by user', 'AbortError'));

    xhr.open('POST', signed.uploadUrl, true);
    xhr.send(formData);
  });

  const rawVoiceDuration = options.durationSeconds ?? cloudResponse.duration;
  const normalizedVoiceDuration =
    typeof rawVoiceDuration === 'number' && Number.isFinite(rawVoiceDuration)
      ? Math.max(1, Math.round(rawVoiceDuration))
      : 1;
  const width =
    typeof cloudResponse.width === 'number' &&
    Number.isFinite(cloudResponse.width) &&
    cloudResponse.width > 0
      ? cloudResponse.width
      : null;
  const height =
    typeof cloudResponse.height === 'number' &&
    Number.isFinite(cloudResponse.height) &&
    cloudResponse.height > 0
      ? cloudResponse.height
      : null;

  const finalizeRes = await apiClient.post<{
    success: boolean;
    data: { attachment: MessageAttachmentItem };
  }>('/uploads/finalize', {
    purpose: options.purpose,
    conversationId: options.conversationId,
    cloudinaryPublicId: cloudResponse.public_id,
    cloudinarySignature: cloudResponse.signature,
    cloudinaryVersion: cloudResponse.version,
    resourceType: signed.resourceType,
    mimeType: options.file.type || 'application/octet-stream',
    originalFilename: options.file.name,
    fileSize: cloudResponse.bytes > 0 ? cloudResponse.bytes : options.file.size,
    width,
    height,
    durationSeconds: options.isVoiceNote
      ? normalizedVoiceDuration
      : cloudResponse.duration ?? null,
    isVoiceNote: Boolean(options.isVoiceNote),
  });

  return finalizeRes.data.data.attachment;
}
