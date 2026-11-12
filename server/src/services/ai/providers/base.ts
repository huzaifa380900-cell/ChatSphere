import { logger } from "../../../config/logger.ts";
import { AppError } from "../../../utils/errors.ts";
import type {
  AIProviderId,
  AITextRequest,
  AITextResponse,
  AIImageRequest,
  AIImageResponse,
  AIAudioRequest,
  AIAudioResponse,
  ProviderConfig,
  ProviderHealth,
  AIError,
  ProviderCapability,
} from "../types.ts";

export function isProviderSafetyRefusal(message: string): boolean {
  return /\b(safety|moderation|content[\s_-]*filter|prohibited|harmful|policy[\s_-]*blocked|blocked[\s_-]*by[\s_-]*policy)\b/i.test(message);
}

export interface BaseAIProvider {
  readonly id: AIProviderId;
  readonly name: string;
  readonly capabilities: ProviderCapability;
  readonly models: Record<string, import("../types.ts").ProviderModel>;
  readonly config: ProviderConfig;
  health: ProviderHealth;

  generateText(request: AITextRequest): Promise<AITextResponse>;
  generateImage?(request: AIImageRequest): Promise<AIImageResponse>;
  transcribeAudio?(request: AIAudioRequest): Promise<AIAudioResponse>;
  checkHealth(): Promise<ProviderHealth>;
  listModels(): Promise<Record<string, import("../types.ts").ProviderModel>>;
}

export abstract class AIProviderBase implements BaseAIProvider {
  abstract readonly id: AIProviderId;
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapability;
  abstract readonly models: Record<string, import("../types.ts").ProviderModel>;

  readonly config: ProviderConfig;
  health: ProviderHealth = {
    available: true,
    consecutiveFailures: 0,
  };

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  protected abstract makeRequest<T>(
    endpoint: string,
    options: RequestInit,
    timeout?: number
  ): Promise<T>;

  protected buildUrl(endpoint: string): string {
    const base = this.config.baseUrl?.replace(/\/$/, "") ?? "";
    return `${base}${endpoint}`;
  }

  protected getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
    };
  }

  protected async handleError(error: unknown, operation: string): Promise<never> {
    if (error instanceof AppError) throw error;

    if (error instanceof Response) {
      const status = error.status;
      if (status === 400 || status === 403) {
        let providerError = '';
        try {
          providerError = await error.clone().text();
        } catch {
          providerError = '';
        }
        if (isProviderSafetyRefusal(providerError)) {
          throw new AppError(status, 'SAFETY_BLOCKED', 'The provider refused this request under its safety policies.');
        }
      }
      const retryHeader = error.headers.get("Retry-After");
      const retrySeconds = retryHeader
        ? (/^\d+(?:\.\d+)?$/.test(retryHeader)
            ? Number(retryHeader)
            : Math.max(0, (Date.parse(retryHeader) - Date.now()) / 1000))
        : undefined;
      const retryAfter = retrySeconds !== undefined && Number.isFinite(retrySeconds) ? retrySeconds : undefined;
      if (status === 429) throw new AppError(429, "RATE_LIMITED", `${this.name} rate limited`, { provider: this.id, retryAfter });
      if (status === 402) throw new AppError(402, "QUOTA_EXHAUSTED", `${this.name} quota exhausted`, { provider: this.id });
      if (status === 401) throw new AppError(401, "PROVIDER_AUTH_FAILED", `${this.name} credentials were rejected`, { provider: this.id });
      if (status === 403) throw new AppError(403, "PROVIDER_ACCESS_DENIED", `${this.name} denied access to this capability`, { provider: this.id });
      if (status === 408 || status >= 500) throw new AppError(503, "PROVIDER_ERROR", `${this.name} temporarily failed (${status})`, { provider: this.id, statusCode: status });
      throw new AppError(status, "PROVIDER_ERROR", `${this.name} rejected the request (${status})`, { provider: this.id, statusCode: status });
    }

    if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
      throw new AppError(504, "TIMEOUT", `${this.name} request timeout`, {
        provider: this.id,
        isTimeout: true,
      });
    }

    const errorType = error instanceof Error ? error.name : "UnknownError";
    logger.error(`${this.name} ${operation} failed`, { provider: this.id, errorType });
    throw new AppError(500, "PROVIDER_ERROR", `${this.name} ${operation} failed.`, {
      provider: this.id,
    });
  }

  protected async requestWithRetry<T>(
    operation: string,
    requestFn: () => Promise<T>,
    retries?: number
  ): Promise<T> {
    const maxRetries = retries ?? this.config.maxRetries ?? 3;
    const retryDelay = this.config.retryDelayMs ?? 1000;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await requestFn();
        this.health.consecutiveFailures = 0;
        this.health.lastSuccess = new Date();
        this.health.available = true;
        return result;
      } catch (error) {
        let normalizedError: unknown = error;
        if (!(error instanceof AppError)) {
          try {
            await this.handleError(error, operation);
          } catch (normalized) {
            normalizedError = normalized;
          }
        }
        lastError = normalizedError;
        this.health.consecutiveFailures++;
        this.health.lastError = normalizedError instanceof Error ? normalizedError.message : 'Provider request failed';
        this.health.available = this.health.consecutiveFailures < 3;

        if (normalizedError instanceof AppError) {
          if (normalizedError.code === "RATE_LIMITED" && normalizedError.details && typeof normalizedError.details === "object" && "retryAfter" in normalizedError.details) {
            const retryAfterSeconds = (normalizedError.details as { retryAfter?: number }).retryAfter;
            const retryAfter = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : retryDelay;
            this.health.retryAfter = retryAfter;
            throw normalizedError;
          }
          if (normalizedError.code === "RATE_LIMITED") {
            this.health.retryAfter = retryDelay;
            throw normalizedError;
          }
          if (normalizedError.code === "QUOTA_EXHAUSTED") {
            throw normalizedError;
          }
          if (normalizedError.code === "TIMEOUT" && attempt < maxRetries) {
            logger.warn(`${this.name} timeout, retrying`, { provider: this.id, attempt: attempt + 1 });
            await this.sleep(retryDelay * (attempt + 1));
            continue;
          }
          if (normalizedError.code === "PROVIDER_ERROR" && attempt < maxRetries) {
            logger.warn(`${this.name} server error, retrying`, { provider: this.id, attempt: attempt + 1 });
            await this.sleep(retryDelay * (attempt + 1));
            continue;
          }
        }
        throw normalizedError;
      }
    }
    throw lastError;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected logRequest(operation: string, request: unknown): void {
    logger.debug(`${this.name} ${operation} request`, {
      provider: this.id,
      request: request,
    });
  }

  protected logResponse(operation: string, response: unknown): void {
    logger.debug(`${this.name} ${operation} response`, {
      provider: this.id,
      response: response,
    });
  }

  abstract generateText(request: AITextRequest): Promise<AITextResponse>;
  abstract generateImage?(request: AIImageRequest): Promise<AIImageResponse>;
  abstract transcribeAudio?(request: AIAudioRequest): Promise<AIAudioResponse>;

  async checkHealth(): Promise<ProviderHealth> {
    return this.health;
  }

  async listModels(): Promise<Record<string, import("../types.ts").ProviderModel>> {
    return this.models;
  }
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
