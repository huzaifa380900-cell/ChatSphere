import React, { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiClient, extractApiError } from '../lib/api.ts';
import type { MessageAttachmentItem } from '../types/models.ts';

interface MediaPreviewModalProps {
  attachment: MessageAttachmentItem | null;
  onClose: () => void;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function MediaPreviewModal({ attachment, onClose }: MediaPreviewModalProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(attachment?.url ?? null);
  const [refreshingUrl, setRefreshingUrl] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const renewSignedUrl = useCallback(async (id: string) => {
    setRefreshingUrl(true);
    setLoadFailed(false);
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { url: string; thumbnailUrl: string | null; expiresAt: string };
      }>(`/uploads/attachments/${id}/url`);
      setResolvedUrl(res.data.data.url);
    } catch (err) {
      setLoadFailed(true);
      toast.error(extractApiError(err).message);
    } finally {
      setRefreshingUrl(false);
    }
  }, []);

  useEffect(() => {
    if (!attachment) return;
    setLoadFailed(false);
    const isExpired =
      attachment.urlExpiresAt &&
      new Date(attachment.urlExpiresAt).getTime() <= Date.now() + 10000;

    if (!attachment.url || isExpired) {
      void renewSignedUrl(attachment.id);
    } else {
      setResolvedUrl(attachment.url);
    }
  }, [attachment, renewSignedUrl]);

  useEffect(() => {
    if (!attachment) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [attachment, onClose]);

  if (!attachment) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${attachment.originalFilename}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-base-200 border border-base-300 rounded-xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-base-300">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-base-content truncate">
              {attachment.originalFilename}
            </p>
            <div className="flex items-center gap-2 text-xs text-base-content/60 tabular-nums">
              <span>{attachment.mimeType}</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(attachment.fileSize)}</span>
              {attachment.width && attachment.height && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    {attachment.width}×{attachment.height}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void renewSignedUrl(attachment.id)}
              disabled={refreshingUrl}
              className="btn btn-sm btn-ghost gap-1.5 whitespace-nowrap"
              title="Refresh short-lived signed URL"
            >
              <RefreshCw className={`w-4 h-4 ${refreshingUrl ? 'animate-spin' : ''}`} />
              <span>Renew Link</span>
            </button>
            {resolvedUrl && (
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={attachment.originalFilename}
                className="btn btn-sm btn-primary gap-1.5 whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                <span>Download</span>
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="btn btn-sm btn-ghost btn-square"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-base-100 min-h-[320px]">
          {refreshingUrl ? (
            <div className="flex flex-col items-center gap-3 text-sm text-base-content/70">
              <span className="loading loading-spinner loading-md text-primary" />
              <span>Authorizing private cloud media access...</span>
            </div>
          ) : loadFailed || !resolvedUrl ? (
            <div className="text-center max-w-sm space-y-3">
              <FileText className="w-10 h-10 text-warning mx-auto" />
              <p className="text-sm font-medium text-base-content">
                Signed media link expired or unavailable
              </p>
              <p className="text-xs text-base-content/60">
                Private attachments use short-lived signed URLs verified against conversation membership.
              </p>
              <button
                type="button"
                onClick={() => void renewSignedUrl(attachment.id)}
                className="btn btn-sm btn-primary"
              >
                Request Fresh Signed URL
              </button>
            </div>
          ) : attachment.attachmentKind === 'IMAGE' || attachment.attachmentKind === 'AVATAR' ? (
            <img
              src={resolvedUrl}
              alt={attachment.originalFilename}
              referrerPolicy="no-referrer"
              onError={() => setLoadFailed(true)}
              className="max-h-[70vh] max-w-full object-contain rounded-lg"
            />
          ) : attachment.attachmentKind === 'VIDEO' ? (
            <video
              src={resolvedUrl}
              controls
              onError={() => setLoadFailed(true)}
              className="max-h-[70vh] max-w-full rounded-lg bg-black"
            />
          ) : attachment.attachmentKind === 'AUDIO' || attachment.attachmentKind === 'VOICE' ? (
            <div className="w-full max-w-md p-6 rounded-xl border border-base-300 bg-base-200 space-y-4">
              <p className="text-sm font-medium text-base-content truncate">
                {attachment.originalFilename}
              </p>
              <audio
                src={resolvedUrl}
                controls
                onError={() => setLoadFailed(true)}
                className="w-full"
              />
            </div>
          ) : (
            <div className="w-full max-w-md p-6 rounded-xl border border-base-300 bg-base-200 text-center space-y-4">
              <FileText className="w-12 h-12 text-primary mx-auto" />
              <div>
                <p className="text-sm font-semibold text-base-content break-all">
                  {attachment.originalFilename}
                </p>
                <p className="text-xs text-base-content/60 mt-1 tabular-nums">
                  {attachment.fileExtension.toUpperCase()} document · {formatBytes(attachment.fileSize)}
                </p>
              </div>
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-primary gap-1.5"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open Secure Document</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
