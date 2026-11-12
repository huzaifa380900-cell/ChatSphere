import { isRealValue } from './env.ts';
import type {
  AIProviderId,
  ProviderConfig,
  ProviderModel,
  ProviderCapability,
  AICapability,
} from '../services/ai/types.ts';

function parseEnvInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (!isRealValue(raw)) return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function parseEnvBool(raw: string | undefined, fallback: boolean): boolean {
  if (!isRealValue(raw)) return fallback;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true;
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false;
  return fallback;
}

const AI_TIMEOUT_DEFAULT = 60000;
const AI_MAX_RETRIES_DEFAULT = 3;
const AI_RETRY_DELAY_DEFAULT = 1000;

const GEMINI_TEXT_MODEL = isRealValue(process.env.GEMINI_TEXT_MODEL) ? process.env.GEMINI_TEXT_MODEL.trim() : 'gemini-3.8-flash';
const geminiFreeTierConfirmed = process.env.AI_GEMINI_FREE_TIER_CONFIRMED === 'true';
const GEMINI_IMAGE_MODEL = isRealValue(process.env.GEMINI_IMAGE_MODEL) ? process.env.GEMINI_IMAGE_MODEL.trim() : 'gemini-nano-banana-2.1';
const geminiImageFreeTierConfirmed = process.env.AI_GEMINI_IMAGE_FREE_TIER_CONFIRMED === 'true';
const cloudflareFreePlanConfirmed = process.env.AI_CLOUDFLARE_FREE_PLAN === 'true';
const OPENROUTER_IMAGE_MODEL = isRealValue(process.env.OPENROUTER_IMAGE_MODEL) ? process.env.OPENROUTER_IMAGE_MODEL.trim() : 'google/gemini-3.1-flash-image';
const GEMINI_MODELS: Record<string, ProviderModel> = {
  [GEMINI_TEXT_MODEL]: {
    id: GEMINI_TEXT_MODEL,
    name: `Gemini text (${GEMINI_TEXT_MODEL})`,
    capabilities: ['text'],
    freeTier: geminiFreeTierConfirmed,
    maxTokens: 8192,
    contextWindow: 1048576,
  },
  [GEMINI_IMAGE_MODEL]: {
    id: GEMINI_IMAGE_MODEL,
    name: `Gemini image (${GEMINI_IMAGE_MODEL})`,
    capabilities: ['image'],
    freeTier: geminiImageFreeTierConfirmed,
  },
};
const GROK_MODELS: Record<string, ProviderModel> = {
  [isRealValue(process.env.XAI_TEXT_MODEL) ? process.env.XAI_TEXT_MODEL.trim() : 'grok-4.7']: {
    id: isRealValue(process.env.XAI_TEXT_MODEL) ? process.env.XAI_TEXT_MODEL.trim() : 'grok-4.7',
    name: 'Grok text model',
    capabilities: ['text'],
    freeTier: false,
    maxTokens: 16384,
    contextWindow: 131072,
  },
  [isRealValue(process.env.XAI_IMAGE_MODEL) ? process.env.XAI_IMAGE_MODEL.trim() : 'grok-imagine-image-2.0']: {
    id: isRealValue(process.env.XAI_IMAGE_MODEL) ? process.env.XAI_IMAGE_MODEL.trim() : 'grok-imagine-image-2.0',
    name: 'Grok Imagine image model',
    capabilities: ['image'],
    freeTier: false,
    pricing: { imagePerGeneration: 0.02 },
  },
};

const CLOUDFLARE_MODELS: Record<string, ProviderModel> = {
  '@cf/meta/llama-3.2-3b-instruct': {
    id: '@cf/meta/llama-3.2-3b-instruct',
    name: 'Llama 3.2 3B Instruct',
    capabilities: ['text'],
    freeTier: cloudflareFreePlanConfirmed,
    maxTokens: 4096,
    contextWindow: 131072,
  },
  '@cf/meta/llama-3.1-8b-instruct': {
    id: '@cf/meta/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    capabilities: ['text'],
    freeTier: cloudflareFreePlanConfirmed,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  '@cf/meta/llama-3.1-70b-instruct': {
    id: '@cf/meta/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    capabilities: ['text'],
    freeTier: cloudflareFreePlanConfirmed,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  '@cf/mistral/mistral-7b-instruct-v0.2': {
    id: '@cf/mistral/mistral-7b-instruct-v0.2',
    name: 'Mistral 7B Instruct v0.2',
    capabilities: ['text'],
    freeTier: cloudflareFreePlanConfirmed,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  '@cf/google/gemma-7b-it': {
    id: '@cf/google/gemma-7b-it',
    name: 'Gemma 7B IT',
    capabilities: ['text'],
    freeTier: cloudflareFreePlanConfirmed,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  '@cf/black-forest-labs/flux-1-schnell': {
    id: '@cf/black-forest-labs/flux-1-schnell',
    name: 'FLUX.1 Schnell',
    capabilities: ['image'],
    freeTier: cloudflareFreePlanConfirmed,
  },
  '@cf/stabilityai/stable-diffusion-xl-base-1.0': {
    id: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    name: 'Stable Diffusion XL Base 1.0',
    capabilities: ['image'],
    freeTier: cloudflareFreePlanConfirmed,
  },
  '@cf/openai/whisper': {
    id: '@cf/openai/whisper',
    name: 'Whisper (Speech-to-Text)',
    capabilities: ['audio'],
    freeTier: cloudflareFreePlanConfirmed,
    pricing: { audioPerSecond: 0.0001 },
  },
  '@cf/openai/whisper-tiny': {
    id: '@cf/openai/whisper-tiny',
    name: 'Whisper Tiny (Speech-to-Text)',
    capabilities: ['audio'],
    freeTier: cloudflareFreePlanConfirmed,
    pricing: { audioPerSecond: 0.00005 },
  },
};

function getConfiguredCloudflareModels(): Record<string, ProviderModel> {
  const configured = {
    text: process.env.CLOUDFLARE_TEXT_MODEL?.trim() || '@cf/meta/llama-3.2-3b-instruct',
    image: process.env.CLOUDFLARE_IMAGE_MODEL?.trim() || '@cf/black-forest-labs/flux-1-schnell',
    audio: process.env.CLOUDFLARE_AUDIO_MODEL?.trim() || '@cf/openai/whisper',
  };
  return Object.fromEntries(Object.values(configured).flatMap((id) => {
    const model = CLOUDFLARE_MODELS[id];
    return model ? [[id, model]] : [];
  }));
}

const OPENROUTER_MODELS: Record<string, ProviderModel> = {
  'openrouter/auto': {
    id: 'openrouter/auto',
    name: 'OpenRouter Auto (Best Available)',
    capabilities: ['text'],
    freeTier: false,
  },
  'google/gemini-flash-1.5': {
    id: 'google/gemini-flash-1.5',
    name: 'Gemini Flash 1.5 (via OpenRouter)',
    capabilities: ['text', 'vision'],
    freeTier: false,
    maxTokens: 8192,
    contextWindow: 1048576,
  },
  'google/gemini-pro-1.5': {
    id: 'google/gemini-pro-1.5',
    name: 'Gemini Pro 1.5 (via OpenRouter)',
    capabilities: ['text', 'vision'],
    freeTier: false,
    pricing: { inputPerMillionTokens: 3.5, outputPerMillionTokens: 10.5 },
    maxTokens: 8192,
    contextWindow: 2097152,
  },
  'anthropic/claude-3.5-sonnet': {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet (via OpenRouter)',
    capabilities: ['text', 'vision'],
    freeTier: false,
    pricing: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
    maxTokens: 8192,
    contextWindow: 200000,
  },
  'anthropic/claude-3-haiku': {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku (via OpenRouter)',
    capabilities: ['text', 'vision'],
    freeTier: false,
    pricing: { inputPerMillionTokens: 0.25, outputPerMillionTokens: 1.25 },
    maxTokens: 4096,
    contextWindow: 200000,
  },
  'meta-llama/llama-3.1-405b-instruct': {
    id: 'meta-llama/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B (via OpenRouter)',
    capabilities: ['text'],
    freeTier: false,
    pricing: { inputPerMillionTokens: 5, outputPerMillionTokens: 5 },
    maxTokens: 4096,
    contextWindow: 131072,
  },
  'meta-llama/llama-3.1-70b-instruct': {
    id: 'meta-llama/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B (via OpenRouter)',
    capabilities: ['text'],
    freeTier: false,
    pricing: { inputPerMillionTokens: 0.9, outputPerMillionTokens: 0.9 },
    maxTokens: 4096,
    contextWindow: 131072,
  },
  'mistralai/mistral-large': {
    id: 'mistralai/mistral-large',
    name: 'Mistral Large (via OpenRouter)',
    capabilities: ['text'],
    freeTier: false,
    pricing: { inputPerMillionTokens: 2, outputPerMillionTokens: 6 },
    maxTokens: 4096,
    contextWindow: 131072,
  },
  'google/gemma-2-9b-it': {
    id: 'google/gemma-2-9b-it',
    name: 'Gemma 2 9B (via OpenRouter)',
    capabilities: ['text'],
    freeTier: false,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  'qwen/qwen-2.5-72b-instruct': {
    id: 'qwen/qwen-2.5-72b-instruct',
    name: 'Qwen 2.5 72B (via OpenRouter)',
    capabilities: ['text'],
    freeTier: false,
    maxTokens: 4096,
    contextWindow: 32768,
  },
  'openai/gpt-4o': {
    id: 'openai/gpt-4o',
    name: 'GPT-4o (via OpenRouter)',
    capabilities: ['text', 'vision'],
    freeTier: false,
    pricing: { inputPerMillionTokens: 5, outputPerMillionTokens: 15 },
    maxTokens: 4096,
    contextWindow: 128000,
  },
  'openai/gpt-4o-mini': {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini (via OpenRouter)',
    capabilities: ['text', 'vision'],
    freeTier: false,
    pricing: { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.6 },
    maxTokens: 4096,
    contextWindow: 128000,
  },
  [OPENROUTER_IMAGE_MODEL]: {
    id: OPENROUTER_IMAGE_MODEL,
    name: `Image generation (${OPENROUTER_IMAGE_MODEL})`,
    capabilities: ['image'],
    freeTier: false,
  },
};

function getGeminiConfig(): ProviderConfig | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!isRealValue(apiKey)) return null;

  return {
    apiKey: apiKey!.trim(),
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: GEMINI_MODELS,
    timeout: parseEnvInt(process.env.GEMINI_TIMEOUT, AI_TIMEOUT_DEFAULT, 1000, 300000),
    maxRetries: parseEnvInt(process.env.GEMINI_MAX_RETRIES, AI_MAX_RETRIES_DEFAULT, 0, 10),
    retryDelayMs: parseEnvInt(process.env.GEMINI_RETRY_DELAY, AI_RETRY_DELAY_DEFAULT, 100, 60000),
  };
}

function getGrokConfig(): ProviderConfig | null {
  const apiKey = process.env.XAI_API_KEY;
  if (!isRealValue(apiKey)) return null;

  return {
    apiKey: apiKey!.trim(),
    baseUrl: 'https://api.x.ai/v1',
    models: GROK_MODELS,
    timeout: parseEnvInt(process.env.XAI_TIMEOUT, AI_TIMEOUT_DEFAULT, 1000, 300000),
    maxRetries: parseEnvInt(process.env.XAI_MAX_RETRIES, AI_MAX_RETRIES_DEFAULT, 0, 10),
    retryDelayMs: parseEnvInt(process.env.XAI_RETRY_DELAY, AI_RETRY_DELAY_DEFAULT, 100, 60000),
  };
}

function getCloudflareConfig(): ProviderConfig | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!isRealValue(accountId) || !isRealValue(apiToken)) return null;

  return {
    apiKey: apiToken!.trim(),
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/' + accountId!.trim() + '/ai',
    models: getConfiguredCloudflareModels(),
    timeout: parseEnvInt(process.env.CLOUDFLARE_TIMEOUT, AI_TIMEOUT_DEFAULT, 1000, 300000),
    maxRetries: parseEnvInt(process.env.CLOUDFLARE_MAX_RETRIES, AI_MAX_RETRIES_DEFAULT, 0, 10),
    retryDelayMs: parseEnvInt(process.env.CLOUDFLARE_RETRY_DELAY, AI_RETRY_DELAY_DEFAULT, 100, 60000),
  };
}

function getOpenRouterConfig(): ProviderConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!isRealValue(apiKey)) return null;

  return {
    apiKey: apiKey!.trim(),
    baseUrl: 'https://openrouter.ai/api/v1',
    models: {},
    timeout: parseEnvInt(process.env.OPENROUTER_TIMEOUT, AI_TIMEOUT_DEFAULT, 1000, 300000),
    maxRetries: parseEnvInt(process.env.OPENROUTER_MAX_RETRIES, AI_MAX_RETRIES_DEFAULT, 0, 10),
    retryDelayMs: parseEnvInt(process.env.OPENROUTER_RETRY_DELAY, AI_RETRY_DELAY_DEFAULT, 100, 60000),
  };
}

const PROVIDER_PRIORITY: AIProviderId[] = ['gemini', 'grok', 'cloudflare', 'openrouter'];

function getProviderCapability(providerId: AIProviderId): ProviderCapability {
  switch (providerId) {
    case 'gemini':
      return { text: true, image: true, audio: false };
    case 'grok':
      return { text: true, image: true, audio: false };
    case 'cloudflare':
      return { text: true, image: true, audio: true };
    case 'openrouter':
      return { text: true, image: true, audio: false };
  }
}

function filterModelsByCapability(
  models: Record<string, ProviderModel>,
  capabilities: AICapability[]
): Record<string, ProviderModel> {
  const result: Record<string, ProviderModel> = {};
  for (const [id, model] of Object.entries(models)) {
    const hasCapability = capabilities.some((cap) =>
      cap === 'text'
        ? model.capabilities.includes('text')
        : cap === 'image'
        ? model.capabilities.includes('image')
        : model.capabilities.includes('audio')
    );
    if (hasCapability) {
      result[id] = model;
    }
  }
  return result;
}

function filterModelsByFreeTier(
  models: Record<string, ProviderModel>,
  allowPaid: boolean
): Record<string, ProviderModel> {
  if (allowPaid) return models;
  const result: Record<string, ProviderModel> = {};
  for (const [id, model] of Object.entries(models)) {
    if (model.freeTier) {
      result[id] = model;
    }
  }
  return result;
}

export interface AIConfig {
  providers: Record<AIProviderId, ProviderConfig | null>;
  allowPaidUsage: boolean;
  defaultTimeout: number;
  defaultMaxRetries: number;
  defaultRetryDelayMs: number;
  providerPriority: AIProviderId[];
  providerCapabilities: Record<AIProviderId, ProviderCapability>;
}

export function loadAIConfig(): AIConfig {
  const providers: Record<AIProviderId, ProviderConfig | null> = {
    gemini: getGeminiConfig(),
    grok: getGrokConfig(),
    cloudflare: getCloudflareConfig(),
    openrouter: getOpenRouterConfig(),
  };

  const allowPaidUsage = parseEnvBool(process.env.AI_ALLOW_PAID_USAGE, false);

  return {
    providers,
    allowPaidUsage,
    defaultTimeout: AI_TIMEOUT_DEFAULT,
    defaultMaxRetries: AI_MAX_RETRIES_DEFAULT,
    defaultRetryDelayMs: AI_RETRY_DELAY_DEFAULT,
    providerPriority: PROVIDER_PRIORITY,
    providerCapabilities: {
      gemini: getProviderCapability('gemini'),
      grok: getProviderCapability('grok'),
      cloudflare: getProviderCapability('cloudflare'),
      openrouter: getProviderCapability('openrouter'),
    },
  };
}

export function getAvailableProviders(config: AIConfig, capabilities: AICapability[] = []): AIProviderId[] {
  return config.providerPriority.filter((providerId) => {
    const provider = config.providers[providerId];
    if (!provider) return false;
    const models = Object.values(getAvailableModels(config, providerId));
    return capabilities.length === 0
      ? models.length > 0
      : capabilities.every((capability) => models.some((model) => model.capabilities.includes(capability)));
  });
}

export function getAvailableModels(
  config: AIConfig,
  providerId: AIProviderId,
  capabilities: AICapability[] = []
): Record<string, ProviderModel> {
  const provider = config.providers[providerId];
  if (!provider) return {};

  let models = filterModelsByCapability(provider.models, capabilities);
  models = filterModelsByFreeTier(models, config.allowPaidUsage);
  return models;
}

export function getBestModel(
  config: AIConfig,
  capabilities: AICapability[],
  preferredProvider?: AIProviderId
): { provider: AIProviderId; model: string } | null {
  const providersToCheck = preferredProvider
    ? [preferredProvider, ...config.providerPriority.filter((p) => p !== preferredProvider)]
    : config.providerPriority;

  for (const providerId of providersToCheck) {
    const models = getAvailableModels(config, providerId, capabilities);
    const modelIds = Object.keys(models);
    if (modelIds.length > 0) {
      return { provider: providerId, model: modelIds[0] };
    }
  }
  return null;
}

export const aiConfig = loadAIConfig();
export type AIConfigType = typeof aiConfig;
