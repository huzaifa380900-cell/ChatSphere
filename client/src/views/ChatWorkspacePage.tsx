'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  AudioLines,
  ArrowLeft,
  BellOff,
  Check,
  CheckCheck,
  CornerUpLeft,
  Edit3,
  ImagePlus,
  Download,
  Copy,
  FileText,
  Flag,
  Info,
  Mic,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Smile,
  Square,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext.tsx';
import { useChatRealtime } from '../context/RealtimeContext.tsx';
import { useRouter, useRouterSearchParams } from '../context/RouterContext.tsx';
import { apiClient, extractApiError, uploadMediaToCloudinary } from '../lib/api.ts';
import { DashboardShell } from '../components/DashboardShell.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { formatBytes, MediaPreviewModal } from '../components/MediaPreviewModal.tsx';
import type {
  ChatMessage,
  ConversationItem,
  MessageAttachmentItem,
  PublicUserSummary,
} from '../types/models.ts';

const QUICK_EMOJIS = ['👍', '🎉', '🚀', '🔥', '✅', '❤️', '👏', '🙌', '💡', '⚡', '😊', '🤝'];

interface UploadingItem {
  localId: string;
  file: File;
  isVoiceNote: boolean;
  progress: number;
  status: 'uploading' | 'error';
  errorMessage?: string;
  controller: AbortController;
}

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getConversationTitle(conv: ConversationItem): string {
  if (conv.type === 'GROUP') {
    return conv.groupMetadata?.name || 'Group Channel';
  }
  return conv.directPeer?.displayName || 'Direct Message';
}

export function ChatWorkspacePage({
  forcedMode = 'ALL',
}: {
  forcedMode?: 'ALL' | 'DIRECT' | 'GROUP';
}) {
  const { user } = useAuth();
  const { searchParams } = useRouterSearchParams();
  const {
    conversations,
    conversationsLoading,
    activeConversationId,
    setActiveConversationId,
    messagesByConversation,
    paginationByConversation,
    typingByConversation,
    refreshConversations,
    loadMessages,
    sendMessageOptimistic,
    retryFailedMessage,
    discardFailedMessage,
    editMessage,
    deleteMessage,
    markConversationRead,
    emitTyping,
  } = useChatRealtime();

  const [sidebarFilter, setSidebarFilter] = useState<'ALL' | 'DIRECT' | 'GROUP' | 'UNREAD'>(
    forcedMode
  );
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [messageText, setMessageText] = useState('');
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [aiWriterOpen, setAiWriterOpen] = useState(false);
  const [aiStickerOpen, setAiStickerOpen] = useState(false);
  const [aiWorking, setAiWorking] = useState(false);
  const [aiWriterInstruction, setAiWriterInstruction] = useState('');
  const [aiWriterText, setAiWriterText] = useState('');
  const [aiWriterAction, setAiWriterAction] = useState<'write' | 'rewrite' | 'grammar' | 'shorten' | 'expand' | 'translate'>('write');
  const [aiWriterTone, setAiWriterTone] = useState<'professional' | 'friendly' | 'casual' | 'romantic' | 'funny' | 'formal'>('friendly');
  const [aiStickerPrompt, setAiStickerPrompt] = useState('');
  const [aiStickerStyle, setAiStickerStyle] = useState<'cartoon' | 'anime' | '3d' | 'realistic'>('cartoon');
  const [aiStickerImage, setAiStickerImage] = useState('');
  const [transcriptionOpen, setTranscriptionOpen] = useState(false);
  const [transcriptionText, setTranscriptionText] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [recordingForTranscription, setRecordingForTranscription] = useState(false);
  const transcriptionRecorderRef = useRef<MediaRecorder | null>(null);
  const transcriptionChunksRef = useRef<BlobPart[]>([]);

  // Staged & in-progress Cloudinary uploads
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([]);
  const [stagedAttachments, setStagedAttachments] = useState<MessageAttachmentItem[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<MessageAttachmentItem | null>(null);

  // Voice note recorder
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<BlobPart[]>([]);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);

  // Right info drawer & conversation search
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);
  const [sharedMedia, setSharedMedia] = useState<MessageAttachmentItem[]>([]);
  const [loadingSharedMedia, setLoadingSharedMedia] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [threadSearchResults, setThreadSearchResults] = useState<ChatMessage[] | null>(null);

  // Modals: New Direct Message, New Group, Report Abuse, Add Member
  const [dmModalOpen, setDmModalOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);
  const [reportTargetMsg, setReportTargetMsg] = useState<ChatMessage | null>(null);
  const [reportReason, setReportReason] = useState<'SPAM' | 'HARASSMENT' | 'MALWARE' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER'>('SPAM');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  // User search state inside modals
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<PublicUserSummary[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  // Group creation state
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupAdminOnlyPost, setGroupAdminOnlyPost] = useState(false);
  const [selectedGroupUsers, setSelectedGroupUsers] = useState<PublicUserSummary[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptionFileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSidebarFilter(forcedMode);
  }, [forcedMode]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const maxHeight = 160;
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, maxHeight)}px`;
    composer.style.overflowY = composer.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [messageText, activeConversationId]);

  // Honor ?conversation=<id> query param from Notifications page
  useEffect(() => {
    const queryConvId = searchParams.get('conversation');
    if (queryConvId) {
      setActiveConversationId(queryConvId);
    }
  }, [searchParams, setActiveConversationId]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );

  // Load initial message page when active conversation changes
  useEffect(() => {
    if (!activeConversationId) return;
    void loadMessages(activeConversationId, null);
    void markConversationRead(activeConversationId);
    setReplyTarget(null);
    setEditingMessage(null);
    setThreadSearchOpen(false);
    setThreadSearchResults(null);
  }, [activeConversationId, loadMessages, markConversationRead]);

  // Scroll to bottom when new messages arrive in active conversation
  const activeMessages = activeConversationId
    ? messagesByConversation[activeConversationId] || []
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activeConversationId]);

  // Load shared media when info drawer opens
  useEffect(() => {
    if (!infoDrawerOpen || !activeConversationId) return;
    let cancelled = false;
    setLoadingSharedMedia(true);
    apiClient
      .get<{ success: boolean; data: { media: MessageAttachmentItem[] } }>(
        `/uploads/conversations/${activeConversationId}/media`
      )
      .then((res) => {
        if (!cancelled) setSharedMedia(res.data.data.media);
      })
      .catch(() => {
        if (!cancelled) setSharedMedia([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSharedMedia(false);
      });
    return () => {
      cancelled = true;
    };
  }, [infoDrawerOpen, activeConversationId]);

  // Live user search with AbortController request cancellation
  useEffect(() => {
    if (!dmModalOpen && !groupModalOpen && !addMemberModalOpen) return;
    const controller = new AbortController();
    setSearchingUsers(true);

    const timer = setTimeout(() => {
      apiClient
        .get<{ success: boolean; data: { users: PublicUserSummary[] } }>('/users/search', {
          params: { q: userSearchTerm, limit: 20 },
          signal: controller.signal,
        })
        .then((res) => {
          setUserSearchResults(res.data.data.users);
        })
        .catch(() => {
          // Ignore cancelled requests
        })
        .finally(() => {
          setSearchingUsers(false);
        });
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [userSearchTerm, dmModalOpen, groupModalOpen, addMemberModalOpen]);

  // Voice recording timer
  useEffect(() => {
    if (!recordingVoice) return;
    const timer = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recordingVoice]);

  const filteredConversations = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    return conversations.filter((c) => {
      if (sidebarFilter === 'DIRECT' && c.type !== 'DIRECT') return false;
      if (sidebarFilter === 'GROUP' && c.type !== 'GROUP') return false;
      if (sidebarFilter === 'UNREAD' && (c.unreadCount || 0) === 0) return false;
      if (!q) return true;
      const title = getConversationTitle(c).toLowerCase();
      const peerHandle = c.directPeer?.username.toLowerCase() || '';
      return title.includes(q) || peerHandle.includes(q);
    });
  }, [conversations, sidebarFilter, sidebarSearch]);

  const startUploadTask = useCallback(
    async (file: File, isVoiceNote = false, durationSeconds?: number) => {
      if (!activeConversationId) return;
      const localId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();

      setUploadingItems((prev) => [
        ...prev,
        {
          localId,
          file,
          isVoiceNote,
          progress: 0,
          status: 'uploading',
          controller,
        },
      ]);

      try {
        const attachment = await uploadMediaToCloudinary({
          file,
          purpose: 'CHAT_ATTACHMENT',
          conversationId: activeConversationId,
          isVoiceNote,
          durationSeconds,
          abortSignal: controller.signal,
          onProgress: (pct) => {
            setUploadingItems((prev) =>
              prev.map((item) => (item.localId === localId ? { ...item, progress: pct } : item))
            );
          },
        });

        setUploadingItems((prev) => prev.filter((item) => item.localId !== localId));
        setStagedAttachments((prev) => [...prev, attachment]);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setUploadingItems((prev) => prev.filter((item) => item.localId !== localId));
          toast('Upload cancelled.');
          return;
        }
        const message = extractApiError(err).message;
        setUploadingItems((prev) =>
          prev.map((item) =>
            item.localId === localId
              ? { ...item, status: 'error', errorMessage: message }
              : item
          )
        );
        toast.error(message);
      }
    },
    [activeConversationId]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      void startUploadTask(f, false);
    }
    e.target.value = '';
  };

  const transcribeAudioFile = async (file: File) => {
    const allowed = new Set(['audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp3']);
    const mimeType = file.type.toLowerCase().split(';')[0].trim();
    if (!allowed.has(mimeType)) {
      toast.error('Choose a supported audio file (WebM, WAV, MP3, MP4, OGG, FLAC, or AAC).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Audio files must be 10 MB or smaller.');
      return;
    }
    setTranscribing(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read audio file.'));
        reader.onerror = () => reject(new Error('Unable to read audio file.'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const response = await apiClient.post<{ success: boolean; data: { text: string } }>('/ai/transcribe', {
        audio: base64,
        mimeType,
      }, { timeout: 120000 });
      setTranscriptionText(response.data.data.text);
      setTranscriptionOpen(true);
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setTranscribing(false);
    }
  };

  const handleTranscriptionFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void transcribeAudioFile(file);
  };

  const handleStartTranscriptionRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast.error('Voice recording is not supported in this browser.');
      return;
    }
    let stream: MediaStream | undefined;
    try {
      const activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream = activeStream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) {
        activeStream.getTracks().forEach((track) => track.stop());
        toast.error('This browser does not support a transcription-compatible audio format.');
        return;
      }
      const recorder = new MediaRecorder(activeStream, { mimeType });
      let recordedBytes = 0;
      let exceededSizeLimit = false;
      transcriptionChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        recordedBytes += event.data.size;
        if (recordedBytes > 10 * 1024 * 1024) {
          exceededSizeLimit = true;
          recorder.stop();
          return;
        }
        transcriptionChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        activeStream.getTracks().forEach((track) => track.stop());
        setRecordingForTranscription(false);
        if (exceededSizeLimit) {
          transcriptionChunksRef.current = [];
          toast.error('Audio files must be 10 MB or smaller. The recording was stopped.');
          return;
        }
        const audio = new Blob(transcriptionChunksRef.current, { type: mimeType });
        const recordedType = recorder.mimeType || mimeType;
        if (audio.size) void transcribeAudioFile(new File([audio], `recording.${recordedType.includes('mp4') ? 'm4a' : 'webm'}`, { type: recordedType }));
        else toast.error('The recording was empty.');
      };
      transcriptionRecorderRef.current = recorder;
      recorder.start(1000);
      setRecordingForTranscription(true);
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      toast.error('Microphone recording could not be started. Check browser support and microphone permission.');
    }
  };

  const handleGenerateWriterText = async () => {
    if (!aiWriterInstruction.trim()) return;
    setAiWorking(true);
    try {
      const response = await apiClient.post<{ success: boolean; data: { text: string } }>('/ai/text', {
        instruction: aiWriterInstruction.trim(),
        text: aiWriterText,
        tone: aiWriterTone,
        action: aiWriterAction,
      }, { timeout: 90000 });
      setAiWriterText(response.data.data.text);
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setAiWorking(false);
    }
  };

  const handleGenerateSticker = async () => {
    if (!aiStickerPrompt.trim()) return;
    setAiWorking(true);
    try {
      const response = await apiClient.post<{ success: boolean; data: { image: string } }>('/ai/image', {
        prompt: aiStickerPrompt.trim(),
        style: aiStickerStyle,
      }, { timeout: 180000 });
      setAiStickerImage(response.data.data.image);
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setAiWorking(false);
    }
  };

  const handleSendAIText = async (text: string) => {
    if (!activeConversationId || !text.trim()) return;
    const replyToSend = replyTarget;
    setReplyTarget(null);
    emitTyping(activeConversationId, false);
    await sendMessageOptimistic({ conversationId: activeConversationId, content: text.trim(), type: 'TEXT', replyTo: replyToSend, stagedAttachments: [] });
    setMessageText('');
    setTranscriptionOpen(false);
    setAiWriterOpen(false);
  };

  const handleRemoveStagedAttachment = async (attId: string) => {
    setStagedAttachments((prev) => prev.filter((a) => a.id !== attId));
    try {
      await apiClient.delete(`/uploads/staged/${attId}`);
    } catch {
      // Server orphan cleaner handles any residual staged upload
    }
  };

  const handleStartVoiceNote = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('Microphone recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const ext = mimeType.includes('webm') ? 'webm' : 'm4a';
      const recorder = new MediaRecorder(stream, { mimeType });
      voiceChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) voiceChunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(voiceChunksRef.current, { type: mimeType });
        const startedAt = voiceRecordingStartedAtRef.current;
        const elapsedSeconds = startedAt === null ? 1 : (Date.now() - startedAt) / 1000;
        const durationSeconds = Math.max(
          1,
          Math.round(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 1)
        );
        voiceRecordingStartedAtRef.current = null;
        if (blob.size > 0) {
          const voiceFile = new File([blob], `voice_note_${Date.now()}.${ext}`, {
            type: mimeType,
          });
          void startUploadTask(voiceFile, true, durationSeconds);
        } else {
          toast.error('The voice note recording was empty. Please try recording again.');
        }
        setRecordingVoice(false);
        setRecordingSeconds(0);
      };

      mediaRecorderRef.current = recorder;
      setRecordingSeconds(0);
      setRecordingVoice(true);
      recorder.start();
      voiceRecordingStartedAtRef.current = Date.now();
    } catch {
      toast.error('Microphone permission denied or unavailable.');
    }
  };

  const handleStopVoiceNote = () => {
    mediaRecorderRef.current?.stop();
  };

  const handleComposerChange = (val: string) => {
    setMessageText(val);
    if (!activeConversationId) return;
    emitTyping(activeConversationId, val.trim().length > 0);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      emitTyping(activeConversationId, false);
    }, 2500);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversationId) return;
    if (!messageText.trim() && stagedAttachments.length === 0) return;

    const textToSend = messageText;
    const attachmentsToSend = [...stagedAttachments];
    const replyToSend = replyTarget;
    const inferredType = attachmentsToSend.some((a) => a.attachmentKind === 'VOICE')
      ? 'VOICE'
      : attachmentsToSend.length > 0
        ? 'MEDIA'
        : 'TEXT';

    setMessageText('');
    setStagedAttachments([]);
    setReplyTarget(null);
    emitTyping(activeConversationId, false);

    await sendMessageOptimistic({
      conversationId: activeConversationId,
      content: textToSend,
      type: inferredType,
      replyTo: replyToSend,
      stagedAttachments: attachmentsToSend,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingMessage || !activeConversationId || !editDraft.trim()) return;
    try {
      await editMessage(activeConversationId, editingMessage.id, editDraft.trim());
      setEditingMessage(null);
      setEditDraft('');
      toast.success('Message updated.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId || !activeConversationId) return;
    try {
      await deleteMessage(activeConversationId, confirmDeleteId);
      setConfirmDeleteId(null);
      toast.success('Message deleted.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleTogglePinOrMute = async (
    conv: ConversationItem,
    patch: { isPinned?: boolean; isMuted?: boolean }
  ) => {
    try {
      await apiClient.patch(`/conversations/${conv.id}/preferences`, patch);
      await refreshConversations();
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleStartDirectChat = async (targetUser: PublicUserSummary) => {
    try {
      const res = await apiClient.post<{
        success: boolean;
        data: { conversation: ConversationItem };
      }>('/conversations/direct', { targetUserId: targetUser.id });
      await refreshConversations();
      setActiveConversationId(res.data.data.conversation.id);
      setDmModalOpen(false);
      setUserSearchTerm('');
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (groupName.trim().length < 2 || selectedGroupUsers.length === 0) {
      toast.error('Provide a group name and select at least one member.');
      return;
    }
    setCreatingGroup(true);
    try {
      const res = await apiClient.post<{
        success: boolean;
        data: { conversation: ConversationItem };
      }>('/conversations/group', {
        name: groupName.trim(),
        description: groupDesc.trim(),
        memberIds: selectedGroupUsers.map((u) => u.id),
        onlyAdminsCanPost: groupAdminOnlyPost,
      });
      await refreshConversations();
      setActiveConversationId(res.data.data.conversation.id);
      setGroupModalOpen(false);
      setGroupName('');
      setGroupDesc('');
      setSelectedGroupUsers([]);
      toast.success('Group channel created.');
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleThreadSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversationId) return;
    if (!threadSearchQuery.trim()) {
      setThreadSearchResults(null);
      return;
    }
    try {
      const res = await apiClient.get<{
        success: boolean;
        data: { messages: ChatMessage[] };
      }>(`/conversations/${activeConversationId}/messages`, {
        params: { q: threadSearchQuery.trim(), limit: 30 },
      });
      setThreadSearchResults(res.data.data.messages);
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleSubmitAbuseReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTargetMsg || reportDetails.trim().length < 10) {
      toast.error('Please enter at least 10 characters describing the issue.');
      return;
    }
    setSubmittingReport(true);
    try {
      await apiClient.post('/notifications/reports', {
        messageId: reportTargetMsg.id,
        conversationId: reportTargetMsg.conversationId,
        targetUserId: reportTargetMsg.senderId,
        reason: reportReason,
        details: reportDetails.trim(),
      });
      toast.success('Report submitted to platform moderators.');
      setReportTargetMsg(null);
      setReportDetails('');
    } catch (err) {
      toast.error(extractApiError(err).message);
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleAddMemberToGroup = async (member: PublicUserSummary) => {
    if (!activeConversationId) return;
    try {
      await apiClient.post(`/conversations/${activeConversationId}/members`, {
        userIds: [member.id],
      });
      await refreshConversations();
      toast.success(`Added ${member.displayName} to group.`);
      setAddMemberModalOpen(false);
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const handleRemoveOrLeaveGroup = async (targetUserId: string) => {
    if (!activeConversationId) return;
    try {
      await apiClient.delete(`/conversations/${activeConversationId}/members/${targetUserId}`);
      if (targetUserId === user?.id) {
        setActiveConversationId(null);
        setInfoDrawerOpen(false);
        toast.success('Left group conversation.');
      } else {
        toast.success('Member removed from group.');
      }
      await refreshConversations();
    } catch (err) {
      toast.error(extractApiError(err).message);
    }
  };

  const activeTypingUsers = activeConversationId
    ? typingByConversation[activeConversationId] || []
    : [];
  const activePagination = activeConversationId
    ? paginationByConversation[activeConversationId]
    : undefined;

  const canPostInActiveGroup =
    !activeConversation ||
    activeConversation.type !== 'GROUP' ||
    !activeConversation.groupMetadata?.onlyAdminsCanPost ||
    activeConversation.myRole !== 'MEMBER';

  return (
    <DashboardShell
      title={
        forcedMode === 'DIRECT'
          ? 'Direct Messages'
          : forcedMode === 'GROUP'
            ? 'Group Channels'
            : 'Messages'
      }
      subtitle="End-to-end PostgreSQL persistence with authenticated live delivery"
      fullBleed
      headerActions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setUserSearchTerm('');
              setDmModalOpen(true);
            }}
            className="btn btn-sm btn-ghost border border-base-300 gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Direct</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setUserSearchTerm('');
              setSelectedGroupUsers([]);
              setGroupModalOpen(true);
            }}
            className="btn btn-sm btn-primary gap-1.5 whitespace-nowrap"
          >
            <Users className="w-4 h-4" />
            <span className="hidden sm:inline">New Group</span>
          </button>
        </div>
      }
    >
      <div className="h-full flex overflow-hidden">
        {/* Conversation List Pane */}
        <section
          aria-label="Conversation list"
          className={`${
            activeConversation ? 'hidden md:flex' : 'flex'
          } w-full md:w-80 xl:w-96 shrink-0 flex-col border-r border-base-300 bg-base-200/40 h-full`}
        >
          <div className="p-3 border-b border-base-300 space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-base-content/50 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
              />
            </div>

            <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-base-100 border border-base-300">
              {(['ALL', 'DIRECT', 'GROUP', 'UNREAD'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSidebarFilter(tab)}
                  className={`py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    sidebarFilter === tab
                      ? 'bg-primary text-primary-content font-semibold'
                      : 'text-base-content/70 hover:text-base-content'
                  }`}
                >
                  {tab === 'ALL'
                    ? 'All'
                    : tab === 'DIRECT'
                      ? 'Direct'
                      : tab === 'GROUP'
                        ? 'Groups'
                        : 'Unread'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-base-300/60">
            {conversationsLoading && conversations.length === 0 ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full skeleton-shimmer shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 skeleton-shimmer rounded-lg w-2/3" />
                      <div className="h-3 skeleton-shimmer rounded-lg w-4/5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm font-medium text-base-content">No conversations found</p>
                <p className="text-xs text-base-content/60">
                  Start a direct message or create a group channel to begin collaborating.
                </p>
                <button
                  type="button"
                  onClick={() => setDmModalOpen(true)}
                  className="btn btn-xs btn-primary"
                >
                  Find People
                </button>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = conv.id === activeConversationId;
                const title = getConversationTitle(conv);
                const isPeerOnline =
                  conv.type === 'DIRECT' && Boolean(conv.directPeer?.presence?.isOnline);
                const lastPreview = conv.lastMessage
                  ? conv.lastMessage.isDeleted
                    ? 'Message deleted'
                    : conv.lastMessage.content ||
                      (conv.lastMessage.attachments.length > 0
                        ? `Sent ${conv.lastMessage.attachments.length} attachment(s)`
                        : 'Started conversation')
                  : 'No messages yet';

                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => setActiveConversationId(conv.id)}
                    className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-all duration-200 cursor-pointer ${
                      isSelected ? 'bg-primary/12 border-l-2 border-primary' : 'hover:bg-white/4 border-l-2 border-transparent'
                    }`}
                  >
                    <Avatar
                      src={
                        conv.type === 'GROUP'
                          ? conv.groupMetadata?.avatarUrl
                          : conv.directPeer?.avatarUrl
                      }
                      name={title}
                      size="md"
                      showPresence={conv.type === 'DIRECT'}
                      isOnline={isPeerOnline}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-base-content truncate flex items-center gap-1.5">
                          <span className="truncate">{title}</span>
                          {conv.isPinned && <Pin className="w-3 h-3 text-primary shrink-0" />}
                          {conv.isMuted && (
                            <BellOff className="w-3 h-3 text-base-content/50 shrink-0" />
                          )}
                        </span>
                        <span className="text-[11px] font-mono text-base-content/55 tabular-nums shrink-0">
                          {formatTimeShort(conv.lastMessageAt)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="text-xs text-base-content/65 truncate">{lastPreview}</p>
                        {conv.unreadCount > 0 && (
                          <span className="text-xs font-mono font-bold text-primary tabular-nums shrink-0">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Active Conversation Thread */}
        {activeConversation ? (
          <section className="flex-1 flex flex-col min-w-0 h-full bg-base-100">
            {/* Thread Header */}
            <div className="h-14 px-4 border-b border-base-300 bg-base-200/40 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveConversationId(null)}
                  className="btn btn-sm btn-ghost btn-square md:hidden"
                  aria-label="Back to conversation list"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <Avatar
                  src={
                    activeConversation.type === 'GROUP'
                      ? activeConversation.groupMetadata?.avatarUrl
                      : activeConversation.directPeer?.avatarUrl
                  }
                  name={getConversationTitle(activeConversation)}
                  size="sm"
                  showPresence={activeConversation.type === 'DIRECT'}
                  isOnline={Boolean(activeConversation.directPeer?.presence?.isOnline)}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-base-content truncate">
                    {getConversationTitle(activeConversation)}
                  </p>
                  <p className="text-xs text-base-content/60 truncate">
                    {activeConversation.type === 'GROUP'
                      ? `${activeConversation.members.length} members · ${activeConversation.myRole}`
                      : activeConversation.directPeer?.presence?.isOnline
                        ? 'Online'
                        : activeConversation.directPeer?.presence?.lastSeenAt
                          ? `Last seen ${formatTimeShort(activeConversation.directPeer.presence.lastSeenAt)}`
                          : `@${activeConversation.directPeer?.username}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setThreadSearchOpen((o) => !o);
                    setThreadSearchResults(null);
                  }}
                  className="btn btn-sm btn-ghost btn-square"
                  aria-label="Search messages in conversation"
                  title="Search messages"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleTogglePinOrMute(activeConversation, {
                      isPinned: !activeConversation.isPinned,
                    })
                  }
                  className={`btn btn-sm btn-ghost btn-square ${
                    activeConversation.isPinned ? 'text-primary' : ''
                  }`}
                  aria-label={activeConversation.isPinned ? 'Unpin conversation' : 'Pin conversation'}
                  title={activeConversation.isPinned ? 'Unpin' : 'Pin'}
                >
                  <Pin className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleTogglePinOrMute(activeConversation, {
                      isMuted: !activeConversation.isMuted,
                    })
                  }
                  className={`btn btn-sm btn-ghost btn-square ${
                    activeConversation.isMuted ? 'text-warning' : ''
                  }`}
                  aria-label={activeConversation.isMuted ? 'Unmute conversation' : 'Mute conversation'}
                  title={activeConversation.isMuted ? 'Unmute' : 'Mute'}
                >
                  <BellOff className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setInfoDrawerOpen((o) => !o)}
                  className={`btn btn-sm btn-ghost btn-square ${
                    infoDrawerOpen ? 'text-primary' : ''
                  }`}
                  aria-label="Conversation details and shared media"
                  title="Conversation info & media"
                >
                  <Info className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Thread Search Bar */}
            {threadSearchOpen && (
              <form
                onSubmit={handleThreadSearch}
                className="px-4 py-2.5 border-b border-base-300 bg-base-200/70 flex items-center gap-2"
              >
                <input
                  type="search"
                  value={threadSearchQuery}
                  onChange={(e) => setThreadSearchQuery(e.target.value)}
                  placeholder="Search message history..."
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
                />
                <button type="submit" className="btn btn-xs btn-primary">
                  Search
                </button>
                {threadSearchResults !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setThreadSearchResults(null);
                      setThreadSearchQuery('');
                    }}
                    className="btn btn-xs btn-ghost"
                  >
                    Clear ({threadSearchResults.length})
                  </button>
                )}
              </form>
            )}

            {/* Messages Stream */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {activePagination?.hasMore && threadSearchResults === null && (
                <div className="text-center">
                  <button
                    type="button"
                    disabled={activePagination.loading}
                    onClick={() =>
                      void loadMessages(activeConversation.id, activePagination.nextCursor)
                    }
                    className="btn btn-xs btn-ghost border border-base-300"
                  >
                    {activePagination.loading ? 'Loading older messages...' : 'Load Earlier Messages'}
                  </button>
                </div>
              )}

              {(threadSearchResults ?? activeMessages).length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-12 text-base-content/60 space-y-2">
                  <p className="text-sm font-medium text-base-content">
                    {threadSearchResults !== null
                      ? 'No matching messages found'
                      : 'Start the conversation'}
                  </p>
                  <p className="text-xs max-w-xs">
                    Messages are saved transactionally in PostgreSQL before delivery acknowledgments.
                  </p>
                </div>
              ) : (
                (threadSearchResults ?? activeMessages).map((msg) => {
                  if (msg.type === 'SYSTEM') {
                    return (
                      <div key={msg.id} className="text-center py-1">
                        <span className="text-xs text-base-content/55">{msg.content}</span>
                      </div>
                    );
                  }

                  const isMine = msg.senderId === user?.id;
                  const readCount = msg.receipts.filter((r) => r.status === 'READ').length;
                  const deliveredCount = msg.receipts.filter(
                    (r) => r.status === 'DELIVERED' || r.status === 'READ'
                  ).length;

                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
                      className={`group flex items-start gap-2.5 ${
                        isMine ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {!isMine && (
                        <Avatar
                          src={msg.sender.avatarUrl}
                          name={msg.sender.displayName}
                          size="xs"
                        />
                      )}

                      <div className={`max-w-[82%] sm:max-w-[70%] space-y-1`}>
                        {!isMine && activeConversation.type === 'GROUP' && (
                          <p className="text-[11px] font-medium text-base-content/65 px-1">
                            {msg.sender.displayName} · @{msg.sender.username}
                          </p>
                        )}

                        <div
                          className={`rounded-xl px-4 py-2.5 border ${
                            msg.isDeleted
                              ? 'bg-base-200/50 border-base-300 text-base-content/50 italic'
                              : isMine
                                ? 'bg-primary/15 border-primary/30 text-base-content'
                                : 'bg-base-200 border-base-300 text-base-content'
                          }`}
                        >
                          {msg.replyTo && !msg.isDeleted && (
                            <div className="mb-2 pb-1.5 border-b border-base-content/15 text-xs text-base-content/70">
                              <span className="font-semibold">{msg.replyTo.sender.displayName}: </span>
                              <span className="line-clamp-1">
                                {msg.replyTo.content || 'Attachment'}
                              </span>
                            </div>
                          )}

                          {editingMessage?.id === msg.id ? (
                            <div className="space-y-2 min-w-[220px]">
                              <textarea
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                rows={2}
                                className="w-full p-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
                              />
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingMessage(null)}
                                  className="btn btn-xs btn-ghost"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveEdit()}
                                  className="btn btn-xs btn-primary"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : msg.isDeleted ? (
                            <p className="text-xs">This message was deleted.</p>
                          ) : (
                            <>
                              {msg.content && (
                                <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                                  {msg.content}
                                </p>
                              )}

                              {msg.attachments.length > 0 && (
                                <div className="mt-2 space-y-2">
                                  {msg.attachments.map((att) => (
                                    <button
                                      key={att.id}
                                      type="button"
                                      onClick={() => setPreviewAttachment(att)}
                                      className="w-full text-left rounded-lg overflow-hidden border border-base-300 bg-base-100/80 hover:border-primary/50 transition-colors cursor-pointer"
                                    >
                                      {att.attachmentKind === 'IMAGE' && (att.thumbnailUrl || att.url) ? (
                                        <img
                                          src={att.thumbnailUrl || att.url || ''}
                                          alt={att.originalFilename}
                                          referrerPolicy="no-referrer"
                                          className="max-h-56 w-full object-cover"
                                        />
                                      ) : (
                                        <div className="p-3 flex items-center gap-3 text-xs">
                                          {att.attachmentKind === 'VOICE' ||
                                          att.attachmentKind === 'AUDIO' ? (
                                            <Volume2 className="w-4 h-4 text-primary shrink-0" />
                                          ) : (
                                            <FileText className="w-4 h-4 text-primary shrink-0" />
                                          )}
                                          <div className="min-w-0 flex-1">
                                            <p className="font-medium text-base-content truncate">
                                              {att.originalFilename}
                                            </p>
                                            <p className="text-base-content/55 tabular-nums">
                                              {att.attachmentKind} · {formatBytes(att.fileSize)}
                                            </p>
                                          </div>
                                        </div>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>

                        {/* Metadata & Actions Row */}
                        <div
                          className={`flex items-center gap-2 text-[11px] text-base-content/55 px-1 tabular-nums ${
                            isMine ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          <span>{formatTimeShort(msg.createdAt)}</span>
                          {msg.isEdited && !msg.isDeleted && <span>· Edited</span>}

                          {isMine && !msg.isDeleted && (
                            <>
                              {msg.optimisticState === 'sending' ? (
                                <span>· Sending...</span>
                              ) : msg.optimisticState === 'failed' ? (
                                <span className="text-error inline-flex items-center gap-1.5">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  <span>Failed</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void retryFailedMessage(
                                        msg.conversationId,
                                        msg.clientMessageId
                                      )
                                    }
                                    className="underline font-medium cursor-pointer"
                                  >
                                    Retry
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      discardFailedMessage(
                                        msg.conversationId,
                                        msg.clientMessageId
                                      )
                                    }
                                    className="underline cursor-pointer"
                                  >
                                    Discard
                                  </button>
                                </span>
                              ) : readCount > 0 ? (
                                <span className="text-primary inline-flex items-center gap-1">
                                  <CheckCheck className="w-3.5 h-3.5" />
                                  <span>Read</span>
                                </span>
                              ) : deliveredCount > 0 ? (
                                <span className="inline-flex items-center gap-1">
                                  <CheckCheck className="w-3.5 h-3.5" />
                                  <span>Delivered</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Sent</span>
                                </span>
                              )}
                            </>
                          )}

                          {/* Hover / Focus Message Actions */}
                          {!msg.isDeleted && !msg.optimisticState && (
                            <span className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity inline-flex items-center gap-1.5 ml-1">
                              <button
                                type="button"
                                onClick={() => setReplyTarget(msg)}
                                title="Reply"
                                aria-label="Reply to message"
                                className="hover:text-primary cursor-pointer"
                              >
                                <CornerUpLeft className="w-3.5 h-3.5" />
                              </button>
                              {isMine && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingMessage(msg);
                                    setEditDraft(msg.content);
                                  }}
                                  title="Edit"
                                  aria-label="Edit message"
                                  className="hover:text-primary cursor-pointer"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {(isMine ||
                                user?.role === 'ADMIN' ||
                                activeConversation.myRole === 'OWNER' ||
                                activeConversation.myRole === 'ADMIN') && (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(msg.id)}
                                  title="Delete"
                                  aria-label="Delete message"
                                  className="hover:text-error cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {!isMine && (
                                <button
                                  type="button"
                                  onClick={() => setReportTargetMsg(msg)}
                                  title="Report message"
                                  aria-label="Report message"
                                  className="hover:text-warning cursor-pointer"
                                >
                                  <Flag className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}

              <AnimatePresence>
                {activeTypingUsers.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-2 px-2"
                  >
                    <div className="flex items-center gap-1 px-3 py-2 rounded-xl rounded-bl-sm bg-base-200 border border-white/8">
                      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-primary" />
                      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-primary" />
                      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-primary" />
                    </div>
                    <span className="text-xs text-base-content/50">
                      {activeTypingUsers.map((u) => u.displayName).join(', ')}{' '}
                      {activeTypingUsers.length === 1 ? 'is' : 'are'} typing…
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={messagesEndRef} />
            </div>

            {/* Composer Area */}
            <div className="border-t border-base-300 bg-base-200/50 p-3 sm:p-4 space-y-2.5 shrink-0">
              {replyTarget && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-base-100 border border-base-300 text-xs">
                  <div className="truncate">
                    <span className="font-semibold text-primary">
                      Replying to {replyTarget.sender.displayName}:{' '}
                    </span>
                    <span className="text-base-content/70">
                      {replyTarget.content || 'Attachment'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTarget(null)}
                    aria-label="Cancel reply"
                    className="text-base-content/60 hover:text-base-content"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Active Cloudinary Uploads & Staged Attachments */}
              {(uploadingItems.length > 0 || stagedAttachments.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {uploadingItems.map((up) => (
                    <div
                      key={up.localId}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-base-100 border border-base-300 text-xs max-w-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{up.file.name}</p>
                        {up.status === 'uploading' ? (
                          <p className="text-primary font-mono tabular-nums">
                            Uploading {up.progress}%
                          </p>
                        ) : (
                          <p className="text-error truncate">{up.errorMessage || 'Upload failed'}</p>
                        )}
                      </div>
                      {up.status === 'uploading' ? (
                        <button
                          type="button"
                          onClick={() => up.controller.abort()}
                          title="Cancel upload"
                          className="btn btn-xs btn-ghost btn-square"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setUploadingItems((prev) =>
                                prev.filter((i) => i.localId !== up.localId)
                              );
                              void startUploadTask(up.file, up.isVoiceNote);
                            }}
                            title="Retry upload"
                            className="btn btn-xs btn-ghost btn-square text-primary"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setUploadingItems((prev) =>
                                prev.filter((i) => i.localId !== up.localId)
                              )
                            }
                            className="btn btn-xs btn-ghost btn-square"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {stagedAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-xs max-w-xs"
                    >
                      <span className="truncate font-medium">{att.originalFilename}</span>
                      <button
                        type="button"
                        onClick={() => void handleRemoveStagedAttachment(att.id)}
                        aria-label="Remove staged attachment"
                        className="text-base-content/70 hover:text-error cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {!canPostInActiveGroup ? (
                <div className="text-xs text-center text-base-content/60 py-2">
                  Only group administrators have permission to post messages in this channel.
                </div>
              ) : recordingVoice ? (
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-error/10 border border-error/30">
                  <div className="flex items-center gap-2 text-xs font-medium text-error tabular-nums">
                    <Mic className="w-4 h-4" />
                    <span>Recording voice message · {recordingSeconds}s</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleStopVoiceNote}
                    className="btn btn-xs btn-error gap-1.5"
                  >
                    <Square className="w-3 h-3" />
                    <span>Finish &amp; Upload</span>
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={handleSend}
                  className="relative flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-2"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                    accept="image/*,video/mp4,video/webm,audio/*,.pdf,.txt,.md,.csv,.docx,.xlsx,.zip"
                  />
                  <input ref={transcriptionFileRef} type="file" accept="audio/*" onChange={handleTranscriptionFileChange} className="hidden" />

                  <div className="order-1 flex min-w-0 max-w-full items-center gap-1 overflow-x-auto sm:contents">
                    <button type="button" onClick={() => { setAiWriterText(messageText); setAiWriterOpen(true); }} className="btn btn-sm btn-ghost btn-square shrink-0" title="AI message writer" aria-label="AI message writer">
                      <WandSparkles className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => setAiStickerOpen(true)} className="btn btn-sm btn-ghost btn-square shrink-0" title="Create AI sticker or avatar" aria-label="Create AI sticker or avatar">
                      <ImagePlus className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="btn btn-sm btn-ghost btn-square shrink-0"
                      title="Upload media or document to Cloudinary"
                      aria-label="Attach file"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleStartVoiceNote()}
                      className="btn btn-sm btn-ghost btn-square shrink-0"
                      title="Record voice message"
                      aria-label="Record voice message"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => transcriptionFileRef.current?.click()} disabled={transcribing} className="btn btn-sm btn-ghost btn-square shrink-0" title="Transcribe an audio file" aria-label="Transcribe an audio file">
                      {transcribing ? <span className="loading loading-spinner loading-xs" /> : <AudioLines className="w-4 h-4" />}
                    </button>
                    <button type="button" onClick={() => recordingForTranscription ? transcriptionRecorderRef.current?.stop() : void handleStartTranscriptionRecording()} disabled={transcribing} className={`btn btn-sm btn-ghost btn-square shrink-0 ${recordingForTranscription ? 'text-error' : ''}`} title={recordingForTranscription ? 'Stop and transcribe recording' : 'Record speech to transcribe'} aria-label={recordingForTranscription ? 'Stop and transcribe recording' : 'Record speech to transcribe'}>
                      {recordingForTranscription ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setEmojiOpen((o) => !o)}
                        className="btn btn-sm btn-ghost btn-square shrink-0"
                        title="Insert emoji"
                        aria-label="Insert emoji"
                      >
                        <Smile className="w-4 h-4" />
                      </button>

                      {emojiOpen && (
                        <div className="absolute bottom-11 left-0 z-30 p-2 rounded-xl bg-base-200 border border-base-300 shadow-lg grid grid-cols-6 gap-1 w-52">
                          {QUICK_EMOJIS.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => {
                                setMessageText((t) => `${t}${em}`);
                                setEmojiOpen(false);
                              }}
                              className="p-1.5 text-base hover:bg-base-300 rounded-md cursor-pointer"
                            >
                              {em}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="order-2 flex w-full min-w-0 items-end gap-2 sm:contents">
                    <textarea
                      ref={composerRef}
                      value={messageText}
                      onChange={(e) => handleComposerChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend(e);
                        }
                      }}
                      rows={1}
                      placeholder="Write a message..."
                      className="min-h-11 max-h-40 w-full min-w-0 flex-1 resize-none overflow-y-hidden break-words rounded-xl border border-base-300 bg-base-100 px-3.5 py-2 text-sm leading-5 focus:border-primary focus:outline-none [overflow-wrap:anywhere]"
                    />

                    <button
                      type="submit"
                      disabled={
                        uploadingItems.some((u) => u.status === 'uploading') ||
                        (!messageText.trim() && stagedAttachments.length === 0)
                      }
                      className="btn btn-sm btn-primary gap-1.5 shrink-0"
                    >
                      <Send className="w-4 h-4" />
                      <span className="hidden sm:inline">Send</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        ) : (
          <section className="hidden md:flex flex-1 flex-col items-center justify-center p-8 text-center bg-base-100">
            <div className="max-w-sm space-y-3">
              <h2 className="text-lg font-semibold text-base-content">Select a conversation</h2>
              <p className="text-xs text-base-content/65 leading-relaxed">
                Choose an existing conversation on the left, or start a new direct chat or group
                channel.
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDmModalOpen(true)}
                  className="btn btn-sm btn-ghost border border-base-300"
                >
                  New Direct Chat
                </button>
                <button
                  type="button"
                  onClick={() => setGroupModalOpen(true)}
                  className="btn btn-sm btn-primary"
                >
                  Create Group
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Right Info & Shared Media Drawer */}
        {activeConversation && infoDrawerOpen && (
          <aside className="w-80 shrink-0 border-l border-base-300 bg-base-200/60 flex flex-col h-full overflow-y-auto p-4 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Conversation Info</h3>
              <button
                type="button"
                onClick={() => setInfoDrawerOpen(false)}
                className="btn btn-xs btn-ghost btn-square"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeConversation.type === 'GROUP' ? (
              <div className="space-y-4">
                <div>
                  <p className="text-base font-bold">{activeConversation.groupMetadata?.name}</p>
                  <p className="text-xs text-base-content/65 mt-1">
                    {activeConversation.groupMetadata?.description || 'No description set.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Members ({activeConversation.members.length})</span>
                    {activeConversation.myRole !== 'MEMBER' && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserSearchTerm('');
                          setAddMemberModalOpen(true);
                        }}
                        className="text-primary inline-flex items-center gap-1 cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {activeConversation.members.map((m) => (
                      <div
                        key={m.userId}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar
                            src={m.user.avatarUrl}
                            name={m.user.displayName}
                            size="xs"
                            showPresence
                            isOnline={Boolean(m.user.presence?.isOnline)}
                          />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{m.user.displayName}</p>
                            <p className="text-base-content/55 truncate">
                              @{m.user.username} · {m.role}
                            </p>
                          </div>
                        </div>

                        {activeConversation.myRole !== 'MEMBER' &&
                          m.userId !== user?.id &&
                          m.role !== 'OWNER' && (
                            <button
                              type="button"
                              onClick={() => void handleRemoveOrLeaveGroup(m.userId)}
                              title="Remove member"
                              className="text-error hover:opacity-80 cursor-pointer"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          )}
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => user && void handleRemoveOrLeaveGroup(user.id)}
                  className="btn btn-xs btn-outline btn-error w-full"
                >
                  Leave Group Channel
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-base font-bold">{activeConversation.directPeer?.displayName}</p>
                <p className="text-xs text-base-content/65">
                  @{activeConversation.directPeer?.username}
                </p>
                {activeConversation.directPeer?.bio && (
                  <p className="text-xs text-base-content/75 pt-1">
                    {activeConversation.directPeer.bio}
                  </p>
                )}
              </div>
            )}

            <div className="border-t border-base-300 pt-4 space-y-2.5">
              <p className="text-xs font-semibold">Shared Cloud Media &amp; Files</p>
              {loadingSharedMedia ? (
                <p className="text-xs text-base-content/60">Loading media...</p>
              ) : sharedMedia.length === 0 ? (
                <p className="text-xs text-base-content/60">No attachments shared yet.</p>
              ) : (
                <div className="space-y-2">
                  {sharedMedia.map((att) => (
                    <button
                      key={att.id}
                      type="button"
                      onClick={() => setPreviewAttachment(att)}
                      className="w-full text-left p-2 rounded-lg border border-base-300 bg-base-100 hover:border-primary/40 flex items-center justify-between gap-2 text-xs cursor-pointer"
                    >
                      <span className="truncate font-medium">{att.originalFilename}</span>
                      <span className="text-base-content/55 font-mono tabular-nums shrink-0">
                        {formatBytes(att.fileSize)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {aiWriterOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-writer-title"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-3 sm:p-6"
          onClick={() => !aiWorking && setAiWriterOpen(false)}
        >
          <div
            className="my-auto max-h-[92vh] w-full max-w-2xl space-y-5 overflow-y-auto rounded-2xl border border-base-300 bg-base-200 p-5 shadow-2xl sm:p-7"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-base-300 pb-4">
              <div className="min-w-0 space-y-1">
                <h2 id="ai-writer-title" className="text-lg font-bold">
                  AI Message Writer
                </h2>
                <p className="text-xs leading-relaxed text-base-content/60">
                  Generated text stays editable until you insert or send it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAiWriterOpen(false)}
                className="btn btn-sm btn-ghost btn-square shrink-0"
                aria-label="Close writer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="label-text text-xs font-medium">Action</span>
                <select
                  className="select select-bordered w-full"
                  value={aiWriterAction}
                  onChange={(event) =>
                    setAiWriterAction(event.target.value as typeof aiWriterAction)
                  }
                >
                  <option value="write">Write a message</option>
                  <option value="rewrite">Rewrite</option>
                  <option value="grammar">Correct grammar</option>
                  <option value="shorten">Shorten</option>
                  <option value="expand">Expand</option>
                  <option value="translate">Translate</option>
                </select>
              </label>
              <label className="block space-y-2">
                <span className="label-text text-xs font-medium">Tone</span>
                <select
                  className="select select-bordered w-full"
                  value={aiWriterTone}
                  onChange={(event) =>
                    setAiWriterTone(event.target.value as typeof aiWriterTone)
                  }
                >
                  <option>friendly</option>
                  <option>professional</option>
                  <option>casual</option>
                  <option>romantic</option>
                  <option>funny</option>
                  <option>formal</option>
                </select>
              </label>
            </div>

            <label className="block space-y-2">
              <span className="label-text text-xs font-medium">Your instruction</span>
              <textarea
                value={aiWriterInstruction}
                onChange={(event) => setAiWriterInstruction(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder={
                  aiWriterAction === 'translate'
                    ? 'Translate into Spanish'
                    : 'What should the message say?'
                }
                className="textarea textarea-bordered min-h-24 w-full resize-y leading-relaxed"
              />
            </label>

            <label className="block space-y-2">
              <span className="label-text text-xs font-medium">Message to work from</span>
              <textarea
                value={aiWriterText}
                onChange={(event) => setAiWriterText(event.target.value)}
                maxLength={12000}
                rows={4}
                placeholder="Type or paste a draft, or leave blank to write from scratch."
                className="textarea textarea-bordered min-h-32 w-full resize-y leading-relaxed"
              />
            </label>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => void handleGenerateWriterText()}
                disabled={aiWorking || !aiWriterInstruction.trim()}
                className="btn btn-primary gap-2"
              >
                {aiWorking ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <WandSparkles className="w-4 h-4" />
                )}
                {aiWorking ? 'Writing…' : 'Generate'}
              </button>
            </div>

            {aiWriterText && (
              <div className="space-y-4 border-t border-base-300 pt-5">
                <label className="block space-y-2">
                  <span className="label-text text-xs font-medium">
                    Generated message (editable)
                  </span>
                  <textarea
                    value={aiWriterText}
                    onChange={(event) => setAiWriterText(event.target.value)}
                    rows={5}
                    className="textarea textarea-bordered min-h-36 w-full resize-y leading-relaxed"
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(aiWriterText)
                        .then(() => toast.success('Copied to clipboard.'))
                        .catch(() => toast.error('Clipboard access is unavailable.'))
                    }
                    className="btn btn-sm btn-ghost gap-1"
                  >
                    <Copy className="w-4 h-4" />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleComposerChange(aiWriterText);
                      setAiWriterOpen(false);
                    }}
                    className="btn btn-sm btn-outline"
                  >
                    Insert in composer
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendAIText(aiWriterText)}
                    disabled={!activeConversationId}
                    className="btn btn-sm btn-primary gap-1"
                  >
                    <Send className="w-4 h-4" />
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {aiStickerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-sticker-title"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/80 p-3 sm:p-6"
          onClick={() => !aiWorking && setAiStickerOpen(false)}
        >
          <div
            className="my-auto max-h-[92vh] w-full max-w-xl space-y-5 overflow-y-auto rounded-2xl border border-base-300 bg-base-200 p-5 shadow-2xl sm:p-7"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-base-300 pb-4">
              <div className="min-w-0 space-y-1">
                <h2 id="ai-sticker-title" className="text-lg font-bold">
                  AI Sticker &amp; Avatar Maker
                </h2>
                <p className="text-xs leading-relaxed text-base-content/60">
                  Describe the subject and choose an art style.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAiStickerOpen(false)}
                className="btn btn-sm btn-ghost btn-square shrink-0"
                aria-label="Close sticker maker"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="block space-y-2">
              <span className="label-text text-xs font-medium">Style</span>
              <select
                className="select select-bordered w-full"
                value={aiStickerStyle}
                onChange={(event) =>
                  setAiStickerStyle(event.target.value as typeof aiStickerStyle)
                }
              >
                <option value="cartoon">Cartoon</option>
                <option value="anime">Anime</option>
                <option value="3d">3D</option>
                <option value="realistic">Realistic avatar</option>
              </select>
            </label>

            <label className="block space-y-2">
              <span className="label-text text-xs font-medium">Prompt</span>
              <textarea
                value={aiStickerPrompt}
                onChange={(event) => setAiStickerPrompt(event.target.value)}
                maxLength={1500}
                rows={4}
                placeholder="A cheerful astronaut cat waving hello"
                className="textarea textarea-bordered min-h-28 w-full resize-y leading-relaxed"
              />
            </label>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => void handleGenerateSticker()}
                disabled={aiWorking || aiStickerPrompt.trim().length < 3}
                className="btn btn-primary gap-2"
              >
                {aiWorking ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <ImagePlus className="w-4 h-4" />
                )}
                {aiWorking ? 'Generating…' : 'Generate image'}
              </button>
            </div>

            {aiStickerImage && (
              <div className="space-y-4 border-t border-base-300 pt-5">
                <div className="flex justify-center rounded-xl border border-base-300 bg-base-100 p-3">
                  <img
                    src={aiStickerImage}
                    alt="AI generated sticker preview"
                    className="max-h-80 max-w-full object-contain"
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <a
                    href={aiStickerImage}
                    download={
                      aiStickerImage.startsWith('data:image/jpeg')
                        ? 'chatsphere-sticker.jpg'
                        : 'chatsphere-sticker.png'
                    }
                    className="btn btn-sm btn-ghost gap-1"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const response = await fetch(aiStickerImage);
                        const blob = await response.blob();
                        const extension = blob.type === 'image/jpeg' ? 'jpg' : 'png';
                        const file = new File(
                          [blob],
                          `chatsphere-sticker-${Date.now()}.${extension}`,
                          { type: blob.type || 'image/png' }
                        );
                        await startUploadTask(file, false);
                        setAiStickerOpen(false);
                        toast.success('Sticker added to the chat composer.');
                      } catch (error) {
                        toast.error(extractApiError(error).message);
                      }
                    }}
                    disabled={!activeConversationId}
                    className="btn btn-sm btn-primary gap-1"
                  >
                    <ImagePlus className="w-4 h-4" />
                    Use in chat
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {transcriptionOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="transcription-title" className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-3 sm:p-6" onClick={() => setTranscriptionOpen(false)}>
          <div className="bg-base-200 border border-base-300 rounded-2xl p-4 sm:p-6 w-full max-w-xl space-y-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between"><div><h2 id="transcription-title" className="text-lg font-bold">Voice transcription</h2><p className="text-xs text-base-content/60">Review and edit the transcript before using it.</p></div><button type="button" onClick={() => setTranscriptionOpen(false)} className="btn btn-sm btn-ghost btn-square" aria-label="Close transcription"><X className="w-4 h-4" /></button></div>
            <textarea value={transcriptionText} onChange={(event) => setTranscriptionText(event.target.value)} rows={6} className="textarea textarea-bordered w-full" aria-label="Editable transcription" />
            <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void navigator.clipboard.writeText(transcriptionText).then(() => toast.success('Copied to clipboard.')).catch(() => toast.error('Clipboard access is unavailable.'))} className="btn btn-sm btn-ghost gap-1"><Copy className="w-4 h-4" />Copy</button><button type="button" onClick={() => { handleComposerChange(transcriptionText); setTranscriptionOpen(false); }} className="btn btn-sm btn-outline">Insert in composer</button><button type="button" onClick={() => void handleSendAIText(transcriptionText)} disabled={!activeConversationId} className="btn btn-sm btn-primary gap-1"><Send className="w-4 h-4" />Send</button></div>
          </div>
        </div>
      )}

      {/* Media Preview Modal */}
      <MediaPreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />

      {/* Delete Confirmation Dialog */}
      {confirmDeleteId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
        >
          <div className="bg-base-200 border border-base-300 rounded-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-semibold">Delete message?</h3>
            <p className="text-xs text-base-content/70 leading-relaxed">
              This removes the message content for all participants and deletes any attached cloud
              media from Cloudinary.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="btn btn-sm btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="btn btn-sm btn-error"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Direct Message Modal */}
      {dmModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
          onClick={() => setDmModalOpen(false)}
        >
          <div
            className="bg-base-200 border border-base-300 rounded-xl p-5 max-w-md w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">New Direct Message</h3>
              <button
                type="button"
                onClick={() => setDmModalOpen(false)}
                className="btn btn-xs btn-ghost btn-square"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="search"
              value={userSearchTerm}
              onChange={(e) => setUserSearchTerm(e.target.value)}
              placeholder="Search by username, name, or email..."
              className="w-full px-3.5 py-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
            />

            <div className="max-h-64 overflow-y-auto divide-y divide-base-300/60">
              {searchingUsers ? (
                <p className="text-xs text-base-content/60 py-4 text-center">Searching users...</p>
              ) : userSearchResults.length === 0 ? (
                <p className="text-xs text-base-content/60 py-4 text-center">
                  No matching active users found.
                </p>
              ) : (
                userSearchResults.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => void handleStartDirectChat(u)}
                    className="w-full text-left py-2.5 px-2 hover:bg-base-300/50 rounded-lg flex items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar
                        src={u.avatarUrl}
                        name={u.displayName}
                        size="sm"
                        showPresence
                        isOnline={Boolean(u.presence?.isOnline)}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{u.displayName}</p>
                        <p className="text-xs text-base-content/60 truncate">@{u.username}</p>
                      </div>
                    </div>
                    <span className="text-xs text-primary font-medium">Message</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Group Conversation Modal */}
      {groupModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
          onClick={() => setGroupModalOpen(false)}
        >
          <form
            onSubmit={handleCreateGroup}
            className="bg-base-200 border border-base-300 rounded-xl p-5 max-w-lg w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Create Group Channel</h3>
              <button
                type="button"
                onClick={() => setGroupModalOpen(false)}
                className="btn btn-xs btn-ghost btn-square"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Channel name (e.g., Security Engineering)"
                required
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
              />
              <input
                type="text"
                value={groupDesc}
                onChange={(e) => setGroupDesc(e.target.value)}
                placeholder="Optional channel purpose or description"
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
              />
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={groupAdminOnlyPost}
                  onChange={(e) => setGroupAdminOnlyPost(e.target.checked)}
                  className="checkbox checkbox-xs checkbox-primary"
                />
                <span>Announcement mode (only group owners/admins can post)</span>
              </label>
            </div>

            {selectedGroupUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedGroupUsers.map((su) => (
                  <button
                    key={su.id}
                    type="button"
                    onClick={() =>
                      setSelectedGroupUsers((prev) => prev.filter((x) => x.id !== su.id))
                    }
                    className="px-2.5 py-1 rounded-md bg-primary/15 text-primary text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>{su.displayName}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}

            <input
              type="search"
              value={userSearchTerm}
              onChange={(e) => setUserSearchTerm(e.target.value)}
              placeholder="Search users to add..."
              className="w-full px-3.5 py-2 text-sm rounded-lg bg-base-100 border border-base-300 focus:outline-none focus:border-primary"
            />

            <div className="max-h-48 overflow-y-auto divide-y divide-base-300/60">
              {userSearchResults.map((u) => {
                const chosen = selectedGroupUsers.some((x) => x.id === u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() =>
                      setSelectedGroupUsers((prev) =>
                        chosen ? prev.filter((x) => x.id !== u.id) : [...prev, u]
                      )
                    }
                    className="w-full text-left py-2 px-2 hover:bg-base-300/50 flex items-center justify-between text-xs cursor-pointer"
                  >
                    <span>
                      <strong className="font-medium">{u.displayName}</strong> · @{u.username}
                    </span>
                    <span className={chosen ? 'text-primary font-semibold' : 'text-base-content/50'}>
                      {chosen ? 'Selected' : 'Add'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGroupModalOpen(false)}
                className="btn btn-sm btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" disabled={creatingGroup} className="btn btn-sm btn-primary">
                {creatingGroup ? 'Creating...' : 'Create Group'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Member to Existing Group Modal */}
      {addMemberModalOpen && activeConversation && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
          onClick={() => setAddMemberModalOpen(false)}
        >
          <div
            className="bg-base-200 border border-base-300 rounded-xl p-5 max-w-md w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Add Group Member</h3>
              <button
                type="button"
                onClick={() => setAddMemberModalOpen(false)}
                className="btn btn-xs btn-ghost btn-square"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="search"
              value={userSearchTerm}
              onChange={(e) => setUserSearchTerm(e.target.value)}
              placeholder="Search active users..."
              className="w-full px-3.5 py-2 text-sm rounded-lg bg-base-100 border border-base-300"
            />

            <div className="max-h-56 overflow-y-auto divide-y divide-base-300/60">
              {userSearchResults
                .filter((u) => !activeConversation.members.some((m) => m.userId === u.id))
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => void handleAddMemberToGroup(u)}
                    className="w-full text-left py-2.5 px-2 hover:bg-base-300/50 flex items-center justify-between text-xs cursor-pointer"
                  >
                    <span>
                      <strong>{u.displayName}</strong> · @{u.username}
                    </span>
                    <span className="text-primary font-semibold">Add</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Report Abuse Modal */}
      {reportTargetMsg && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
          onClick={() => setReportTargetMsg(null)}
        >
          <form
            onSubmit={handleSubmitAbuseReport}
            className="bg-base-200 border border-base-300 rounded-xl p-5 max-w-md w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Report Content</h3>
              <button
                type="button"
                onClick={() => setReportTargetMsg(null)}
                className="btn btn-xs btn-ghost btn-square"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium">
                Reason
                <select
                  value={reportReason}
                  onChange={(e) =>
                    setReportReason(e.target.value as typeof reportReason)
                  }
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg bg-base-100 border border-base-300"
                >
                  <option value="SPAM">Spam or unsolicited promotion</option>
                  <option value="HARASSMENT">Harassment or abusive conduct</option>
                  <option value="MALWARE">Malicious link or attachment</option>
                  <option value="IMPERSONATION">Account impersonation</option>
                  <option value="ILLEGAL_CONTENT">Illegal or prohibited content</option>
                  <option value="OTHER">Other policy concern</option>
                </select>
              </label>

              <label className="block text-xs font-medium">
                Details for moderators
                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  rows={3}
                  required
                  minLength={10}
                  placeholder="Describe why this message violates workspace policy..."
                  className="mt-1 w-full p-2.5 text-sm rounded-lg bg-base-100 border border-base-300"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportTargetMsg(null)}
                className="btn btn-sm btn-ghost"
              >
                Cancel
              </button>
              <button type="submit" disabled={submittingReport} className="btn btn-sm btn-warning">
                {submittingReport ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        </div>
      )}
    </DashboardShell>
  );
}
