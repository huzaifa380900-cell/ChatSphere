import { aiConfig, getAvailableModels } from '../../config/ai.ts';
import { AppError } from '../../utils/errors.ts';
import type { AICapability, AIProviderId, ProviderConfig, ProviderModel } from './types.ts';
import type { BaseAIProvider } from './providers/base.ts';
import { createGeminiProvider } from './providers/gemini.ts';
import { createGrokProvider } from './providers/grok.ts';
import { createCloudflareProvider } from './providers/cloudflare.ts';
import { createOpenRouterProvider } from './providers/openrouter.ts';

const factories = {
  gemini: createGeminiProvider,
  grok: createGrokProvider,
  cloudflare: createCloudflareProvider,
  openrouter: createOpenRouterProvider,
} as const;

type Operation = AICapability;
const capabilities: AICapability[] = ['text', 'image', 'audio'];
const unavailableUntil = new Map<string, number>();
const openRouterCatalogCache = new Map<string, { expiresAt: number; models: Record<string, ProviderModel> }>();
const OPENROUTER_CATALOG_TTL_MS = 5 * 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60_000;
const PROVIDER_NAMES: Record<AIProviderId, string> = {
  gemini: 'Gemini',
  grok: 'Grok',
  cloudflare: 'Cloudflare Workers AI',
  openrouter: 'OpenRouter',
};

export function resetAICooldowns(): void {
  unavailableUntil.clear();
  openRouterCatalogCache.clear();
}

function isEligible(model: ProviderModel, operation: Operation): boolean {
  return model.capabilities.includes(operation) && (aiConfig.allowPaidUsage || model.freeTier);
}

function getCooldown(id: AIProviderId, capability: AICapability) {
  const availableAfter = unavailableUntil.get(`${id}:${capability}`) ?? 0;
  return {
    temporarilyUnavailable: availableAfter > Date.now(),
    availableAfter: availableAfter > Date.now() ? new Date(availableAfter).toISOString() : null,
  };
}

async function getOpenRouterCatalog(
  config: ProviderConfig,
  operation: Operation
): Promise<Record<string, ProviderModel>> {
  const catalogType = operation === 'audio' ? 'transcription' : 'models';
  const cached = openRouterCatalogCache.get(catalogType);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const provider = createOpenRouterProvider(config);
  const models = catalogType === 'transcription'
    ? await provider.listTranscriptionModels()
    : await provider.listModels();
  openRouterCatalogCache.set(catalogType, {
    models,
    expiresAt: Date.now() + OPENROUTER_CATALOG_TTL_MS,
  });
  return models;
}

export async function getAIProviderStatus() {
  return Promise.all(aiConfig.providerPriority.map(async (id) => {
    const config = aiConfig.providers[id];
    let models: Record<string, ProviderModel> = {};
    let modelCatalogAvailable: boolean | null = config ? true : null;
    let transcriptionCatalogAvailable: boolean | null = config ? true : null;

    if (config && id === 'openrouter') {
      if (['text', 'image'].some((capability) =>
        (unavailableUntil.get(`${id}:${capability}`) ?? 0) > Date.now()
      )) {
        modelCatalogAvailable = false;
      } else {
        try {
          models = await getOpenRouterCatalog(config, 'text');
        } catch (error) {
          modelCatalogAvailable = false;
          markUnavailable(id, 'text', error);
          markUnavailable(id, 'image', error);
        }
      }
      if ((unavailableUntil.get(`${id}:audio`) ?? 0) > Date.now()) {
        transcriptionCatalogAvailable = false;
      } else {
        try {
          models = {
            ...models,
            ...await getOpenRouterCatalog(config, 'audio'),
          };
        } catch (error) {
          transcriptionCatalogAvailable = false;
          markUnavailable(id, 'audio', error);
        }
      }
    } else if (config) {
      models = Object.fromEntries(
        Object.entries(getAvailableModels(aiConfig, id))
          .filter(([, model]) => aiConfig.allowPaidUsage || model.freeTier)
      );
    }

    const eligible = Object.values(models).filter((model) =>
      aiConfig.allowPaidUsage || model.freeTier
    );
    const availability = Object.fromEntries(capabilities.map((capability) => [
      capability,
      getCooldown(id, capability),
    ]));
    const cooldown = Math.max(...capabilities.map((capability) =>
      unavailableUntil.get(`${id}:${capability}`) ?? 0
    ));

    return {
      id,
      configured: Boolean(config),
      models: [...new Set(eligible.map((model) => model.id))],
      capabilities: {
        text: eligible.some((model) => model.capabilities.includes('text')),
        image: eligible.some((model) => model.capabilities.includes('image')),
        audio: eligible.some((model) => model.capabilities.includes('audio')),
      },
      catalog: id === 'openrouter'
        ? { models: modelCatalogAvailable, transcription: transcriptionCatalogAvailable }
        : null,
      availability,
      temporarilyUnavailable: cooldown > Date.now(),
      availableAfter: cooldown > Date.now() ? new Date(cooldown).toISOString() : null,
    };
  }));
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (error instanceof Response) {
    const value = error.headers.get('Retry-After');
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateMs = Date.parse(value) - Date.now();
    return Number.isFinite(dateMs) ? Math.max(0, dateMs) : undefined;
  }
  if (error instanceof AppError && typeof error.details === 'object' && error.details) {
    const value = (error.details as { retryAfter?: unknown }).retryAfter;
    const seconds = Number(value);
    if (value !== undefined && Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  }
  return undefined;
}

function markUnavailable(id: AIProviderId, capability: AICapability, error: unknown): void {
  const cooldownMs = Math.min(getRetryAfterMs(error) ?? DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS);
  const key = `${id}:${capability}`;
  if (cooldownMs > 0) unavailableUntil.set(key, Date.now() + cooldownMs);
  else unavailableUntil.delete(key);
}

function getProviderFailureLabel(error: unknown): string {
  if (error instanceof AppError) {
    if (error.code === 'PROVIDER_AUTH_FAILED') return 'credentials rejected';
    if (error.code === 'QUOTA_EXHAUSTED') return 'quota exhausted';
    if (error.code === 'RATE_LIMITED') return 'rate limited';
    if (error.code === 'PROVIDER_ACCESS_DENIED') return 'model access denied';
    if (error.code === 'TIMEOUT') return 'request timed out';
    if (error.code === 'AI_EMPTY_RESPONSE') return 'empty provider response';
    if (error.code === 'AI_INVALID_IMAGE') return 'invalid image response';
    if (error.code === 'SAFETY_BLOCKED' || error.code === 'CONTENT_FILTERED') return 'request refused by safety policy';
    if (error.statusCode === 404 || error.code === 'MODEL_NOT_FOUND') return 'configured model is unavailable';
    if (error.statusCode >= 500) return 'provider service error';
    if (error.statusCode === 400) return 'provider rejected the request or model';
  }
  if (error instanceof Response) {
    if (error.status === 401) return 'credentials rejected';
    if (error.status === 402) return 'quota exhausted';
    if (error.status === 403) return 'model access denied';
    if (error.status === 404) return 'configured model is unavailable';
    if (error.status === 429) return 'rate limited';
    if (error.status >= 500) return 'provider service error';
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return 'network error';
  return 'request failed';
}

export async function runAI<T>(
  operation: Operation,
  invoke: (provider: BaseAIProvider, model: string) => Promise<T>
): Promise<{ result: T; provider: AIProviderId; model: string }> {
  const failures: Array<{ provider: AIProviderId; model?: string; reason: string }> = [];

  for (const id of aiConfig.providerPriority) {
    const config = aiConfig.providers[id];
    const cooldownKey = `${id}:${operation}`;
    if (!config || (unavailableUntil.get(cooldownKey) ?? 0) > Date.now()) continue;

    const provider = factories[id](config as ProviderConfig);
    let candidateModels: Record<string, ProviderModel>;
    try {
      if (id === 'openrouter') {
        candidateModels = await getOpenRouterCatalog(config, operation);
      } else {
        candidateModels = getAvailableModels(aiConfig, id, [operation]);
      }
    } catch (error) {
      failures.push({ provider: id, reason: getProviderFailureLabel(error) });
      markUnavailable(id, operation, error);
      continue;
    }

    const preferredOpenRouterModel = id === 'openrouter'
      ? process.env[operation === 'image' ? 'OPENROUTER_IMAGE_MODEL' : 'OPENROUTER_TEXT_MODEL']?.trim()
      : undefined;
    const eligible = Object.values(candidateModels)
      .filter((model) => isEligible(model, operation))
      .sort((a, b) =>
        Number(b.freeTier) - Number(a.freeTier)
        || Number(b.id === preferredOpenRouterModel) - Number(a.id === preferredOpenRouterModel)
      );
      if (!eligible.length) continue;

      const candidates = id === 'openrouter' ? eligible.slice(0, 3) : eligible.slice(0, 1);
    let providerFailed = false;
    for (const candidate of candidates) {
      try {
        const result = await invoke(provider, candidate.id);
        unavailableUntil.delete(cooldownKey);
        return { result, provider: id, model: candidate.id };
      } catch (error) {
        if (error instanceof AppError && ['CONTENT_FILTERED', 'SAFETY_BLOCKED'].includes(error.code)) throw error;

        providerFailed = true;
        failures.push({ provider: id, model: candidate.id, reason: getProviderFailureLabel(error) });
        const status = error instanceof AppError
          ? error.statusCode
          : error instanceof Response
            ? error.status
            : 0;

        if (status === 401 || status === 402 || status === 429) {
          markUnavailable(id, operation, error);
          break;
        }
      }
    }
    if (providerFailed && !(unavailableUntil.get(cooldownKey)! > Date.now())) {
      markUnavailable(id, operation, new Error('Provider models failed'));
    }
  }

  const failureSummary = [...new Set(failures.map((failure) =>
    `${PROVIDER_NAMES[failure.provider]}: ${failure.reason}`
  ))].join('; ');
  throw new AppError(
    503,
    'AI_UNAVAILABLE',
    failureSummary
      ? `AI generation failed. Provider status: ${failureSummary}. Please try again later.`
      : `No eligible provider currently supports ${operation} under the configured usage policy.`,
    failures.length ? { providerFailures: failures } : undefined,
  );
}
