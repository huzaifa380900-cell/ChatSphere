export type AIProviderId = 'gemini' | 'grok' | 'cloudflare' | 'openrouter';

export type AICapability = 'text' | 'image' | 'audio';

export type AIModelCapability = 'text' | 'image' | 'audio' | 'vision';

export interface ProviderCapability {
  text: boolean;
  image: boolean;
  audio: boolean;
}

export interface ProviderModel {
  id: string;
  name: string;
  capabilities: AIModelCapability[];
  freeTier: boolean;
  pricing?: {
    inputPerMillionTokens?: number;
    outputPerMillionTokens?: number;
    imagePerGeneration?: number;
    audioPerSecond?: number;
  };
  maxTokens?: number;
  contextWindow?: number;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  models: Record<string, ProviderModel>;
  timeout: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface ProviderHealth {
  available: boolean;
  lastError?: string;
  retryAfter?: number;
  consecutiveFailures: number;
  lastSuccess?: Date;
}

export interface AITextRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    toolCalls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }>;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stop?: string[];
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  responseFormat?: { type: 'json_object' } | { type: 'text' };
  seed?: number;
  user?: string;
}

export interface AITextResponse {
  id: string;
  model: string;
  provider: AIProviderId;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  created: number;
}

export interface AIImageRequest {
  model: string;
  prompt: string;
  negativePrompt?: string;
  n?: number;
  size?: string;
  quality?: 'low' | 'medium' | 'auto';
  aspectRatio?: string;
  resolution?: '1k' | '2k';
  style?: 'vivid' | 'natural';
  responseFormat?: 'url' | 'b64_json';
  seed?: number;
}

export interface AIImageResponse {
  id: string;
  model: string;
  provider: AIProviderId;
  data: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
    revisedPrompt?: string;
  }>;
  created: number;
  usage?: {
    totalImages: number;
  };
}

export interface AIAudioRequest {
  model: string;
  audio: string;
  mimeType?: string;
  language?: string;
  prompt?: string;
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
  temperature?: number;
  timestampGranularities?: Array<'word' | 'segment'>;
}

export interface AIAudioResponse {
  id: string;
  model: string;
  provider: AIProviderId;
  text: string;
  language?: string;
  duration?: number;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  segments?: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    words?: Array<{
      word: string;
      start: number;
      end: number;
      confidence: number;
    }>;
  }>;
  created: number;
}

export type AIRequest = AITextRequest | AIImageRequest | AIAudioRequest;
export type AIResponse = AITextResponse | AIImageResponse | AIAudioResponse;

export interface AIRouterOptions {
  preferredProvider?: AIProviderId;
  allowedProviders?: AIProviderId[];
  capabilities?: AICapability[];
  allowPaid?: boolean;
  fallback?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface ProviderRegistration {
  id: AIProviderId;
  name: string;
  capabilities: ProviderCapability;
  models: Record<string, ProviderModel>;
  config: ProviderConfig;
  health: ProviderHealth;
}

export interface AIRoutingResult {
  provider: AIProviderId;
  model: string;
  reason: string;
}

export interface AIError extends Error {
  provider: AIProviderId;
  statusCode?: number;
  retryAfter?: number;
  isRetryable: boolean;
  isRateLimit: boolean;
  isQuotaExhausted: boolean;
  isServerError: boolean;
  isTimeout: boolean;
}

export function isAIError(error: unknown): error is AIError {
  return error instanceof Error && 'provider' in error && 'isRetryable' in error;
}

export function createAIError(
  provider: AIProviderId,
  message: string,
  options: {
    statusCode?: number;
    retryAfter?: number;
    isRetryable?: boolean;
    isRateLimit?: boolean;
    isQuotaExhausted?: boolean;
    isServerError?: boolean;
    isTimeout?: boolean;
  } = {}
): AIError {
  const error = new Error(message) as AIError;
  error.provider = provider;
  error.statusCode = options.statusCode;
  error.retryAfter = options.retryAfter;
  error.isRetryable = options.isRetryable ?? true;
  error.isRateLimit = options.isRateLimit ?? false;
  error.isQuotaExhausted = options.isQuotaExhausted ?? false;
  error.isServerError = options.isServerError ?? false;
  error.isTimeout = options.isTimeout ?? false;
  return error;
}
