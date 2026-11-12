import { AppError } from "../../../utils/errors.ts";
import { AIProviderBase } from "./base.ts";
import type {
  AIProviderId,
  AITextRequest,
  AITextResponse,
  AIImageRequest,
  AIImageResponse,
  AIAudioRequest,
  AIAudioResponse,
  ProviderConfig,
  ProviderCapability,
  ProviderModel,
} from "../types.ts";

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: object };
  }>;
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  response_format?: { type: "json_object" } | { type: "text" };
  seed?: number;
  user?: string;
  models?: string[];
  route?: "fallback" | "primary";
  provider?: {
    order?: string[];
    allow_fallbacks?: boolean;
    require_parameters?: boolean;
    data_collection?: "allow" | "deny";
    quantization?: string;
  };
}

interface OpenRouterResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenRouterImageRequest {
  model: string;
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: string;
}

interface OpenRouterImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
    media_type?: string;
  }>;
}

interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name: string;
    description: string;
    pricing: {
      prompt?: string;
      completion?: string;
      image?: string;
      image_token?: string;
      image_output?: string;
      request?: string;
      [key: string]: string | undefined;
    };
    context_length: number;
    architecture: {
      modality: string;
      tokenizer: string;
      instruct_type?: string;
      input_modalities?: string[];
      output_modalities?: string[];
    };
    top_provider: { max_completion_tokens: number; is_moderated: boolean };
    per_request_limits?: any;
  }>;
}

function parsePrice(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const OPENROUTER_MODELS: Record<string, ProviderModel> = {
  "openrouter/auto": {
    id: "openrouter/auto",
    name: "OpenRouter Auto (Best Available)",
    capabilities: ["text"],
    freeTier: false,
  },
  "google/gemini-flash-1.5": {
    id: "google/gemini-flash-1.5",
    name: "Gemini Flash 1.5 (via OpenRouter)",
    capabilities: ["text", "vision"],
    freeTier: false,
    maxTokens: 8192,
    contextWindow: 1048576,
  },
  "google/gemini-pro-1.5": {
    id: "google/gemini-pro-1.5",
    name: "Gemini Pro 1.5 (via OpenRouter)",
    capabilities: ["text", "vision"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 3.5, outputPerMillionTokens: 10.5 },
    maxTokens: 8192,
    contextWindow: 2097152,
  },
  "anthropic/claude-3.5-sonnet": {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet (via OpenRouter)",
    capabilities: ["text", "vision"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
    maxTokens: 8192,
    contextWindow: 200000,
  },
  "anthropic/claude-3-haiku": {
    id: "anthropic/claude-3-haiku",
    name: "Claude 3 Haiku (via OpenRouter)",
    capabilities: ["text", "vision"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 0.25, outputPerMillionTokens: 1.25 },
    maxTokens: 4096,
    contextWindow: 200000,
  },
  "meta-llama/llama-3.1-405b-instruct": {
    id: "meta-llama/llama-3.1-405b-instruct",
    name: "Llama 3.1 405B (via OpenRouter)",
    capabilities: ["text"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 5, outputPerMillionTokens: 5 },
    maxTokens: 4096,
    contextWindow: 131072,
  },
  "meta-llama/llama-3.1-70b-instruct": {
    id: "meta-llama/llama-3.1-70b-instruct",
    name: "Llama 3.1 70B (via OpenRouter)",
    capabilities: ["text"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 0.9, outputPerMillionTokens: 0.9 },
    maxTokens: 4096,
    contextWindow: 131072,
  },
  "mistralai/mistral-large": {
    id: "mistralai/mistral-large",
    name: "Mistral Large (via OpenRouter)",
    capabilities: ["text"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 2, outputPerMillionTokens: 6 },
    maxTokens: 4096,
    contextWindow: 131072,
  },
  "google/gemma-2-9b-it": {
    id: "google/gemma-2-9b-it",
    name: "Gemma 2 9B (via OpenRouter)",
    capabilities: ["text"],
    freeTier: false,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  "qwen/qwen-2.5-72b-instruct": {
    id: "qwen/qwen-2.5-72b-instruct",
    name: "Qwen 2.5 72B (via OpenRouter)",
    capabilities: ["text"],
    freeTier: false,
    maxTokens: 4096,
    contextWindow: 32768,
  },
  "openai/gpt-4o": {
    id: "openai/gpt-4o",
    name: "GPT-4o (via OpenRouter)",
    capabilities: ["text", "vision"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 5, outputPerMillionTokens: 15 },
    maxTokens: 4096,
    contextWindow: 128000,
  },
  "openai/gpt-4o-mini": {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini (via OpenRouter)",
    capabilities: ["text", "vision"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 0.15, outputPerMillionTokens: 0.6 },
    maxTokens: 4096,
    contextWindow: 128000,
  },
  "google/imagen-3": {
    id: "google/imagen-3",
    name: "Imagen 3 (via OpenRouter)",
    capabilities: ["image"],
    freeTier: false,
    pricing: { imagePerGeneration: 0.04 },
  },
  "stabilityai/stable-diffusion-3": {
    id: "stabilityai/stable-diffusion-3",
    name: "Stable Diffusion 3 (via OpenRouter)",
    capabilities: ["image"],
    freeTier: false,
    pricing: { imagePerGeneration: 0.065 },
  },
};

export class OpenRouterProvider extends AIProviderBase {
  readonly id: AIProviderId = "openrouter";
  readonly name = "OpenRouter";
  readonly capabilities: ProviderCapability = { text: true, image: true, audio: false };
  readonly models = OPENROUTER_MODELS;

  constructor(config: ProviderConfig) {
    super(config);
  }

  protected getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "HTTP-Referer": "https://chatsphere.app",
      "X-Title": "ChatSphere",
    };
  }

  protected async makeRequest<T>(
    endpoint: string,
    options: RequestInit,
    timeout?: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = timeout ?? this.config.timeout ?? 60000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.buildUrl(endpoint), {
        ...options,
        signal: controller.signal,
        headers: {
          ...this.getHeaders(),
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw response;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TypeError("fetch timeout");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private convertMessages(messages: AITextRequest["messages"]): OpenRouterMessage[] {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
      name: m.name,
      tool_calls: m.toolCalls,
    }));
  }

  async generateText(request: AITextRequest): Promise<AITextResponse> {
    this.logRequest("generateText", { model: request.model, messagesCount: request.messages.length });

    const orRequest: OpenRouterRequest = {
      model: request.model,
      messages: this.convertMessages(request.messages),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop: request.stop,
      stream: request.stream,
      tools: request.tools,
      tool_choice: request.toolChoice,
      response_format: request.responseFormat,
      seed: request.seed,
      user: request.user,
    };

    const response = await this.requestWithRetry<OpenRouterResponse>(
      "generateText",
      () => this.makeRequest("/chat/completions", { method: "POST", body: JSON.stringify(orRequest) })
    );

    this.logResponse("generateText", { choices: response.choices?.length ?? 0 });

    const choice = response.choices?.[0];
    if (!choice) {
      throw new AppError(500, "PROVIDER_ERROR", "No response from OpenRouter", { provider: this.id });
    }

    return {
      id: response.id,
      model: response.model,
      provider: this.id,
      choices: response.choices.map((c) => ({
        index: c.index,
        message: {
          role: "assistant",
          content: c.message.content,
          toolCalls: c.message.tool_calls?.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        },
        finishReason: c.finish_reason ?? "stop",
      })),
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      created: response.created,
    };
  }

  async generateImage(request: AIImageRequest): Promise<AIImageResponse> {
    this.logRequest("generateImage", { model: request.model, promptLength: request.prompt.length });

    const orRequest: OpenRouterImageRequest = {
      model: request.model,
      prompt: request.prompt,
      n: request.n ?? 1,
      aspect_ratio: request.aspectRatio ?? '1:1',
      resolution: (request.resolution ?? '1k').toUpperCase(),
    };

    const response = await this.requestWithRetry<OpenRouterImageResponse>(
      "generateImage",
      () => this.makeRequest("/images", { method: "POST", body: JSON.stringify(orRequest) })
    );

    this.logResponse("generateImage", { images: response.data?.length ?? 0 });

    return {
      id: `or-img-${Date.now()}`,
      model: request.model,
      provider: this.id,
      data: response.data.map((img) => ({
        url: img.url,
        b64Json: img.b64_json,
        revisedPrompt: img.revised_prompt,
        mimeType: img.media_type,
      })),
      created: response.created,
      usage: { totalImages: response.data.length },
    };
  }

  async transcribeAudio(request: AIAudioRequest): Promise<AIAudioResponse> {
    const format = (request.mimeType?.split('/')[1] || 'wav').replace(/^x-/, '').replace('mpeg', 'mp3').replace('mp4', 'm4a');
    const response = await this.requestWithRetry<{ text: string; usage?: { seconds?: number } }>(
      'transcribeAudio',
      () => this.makeRequest('/audio/transcriptions', {
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          input_audio: { data: request.audio, format },
          language: request.language,
        }),
      }),
    );
    if (!response.text) throw new AppError(502, 'AI_EMPTY_RESPONSE', 'The transcription provider returned no text.');
    return { id: `openrouter-audio-${Date.now()}`, model: request.model, provider: this.id, text: response.text, duration: response.usage?.seconds, created: Math.floor(Date.now() / 1000) };
  }

  async listTranscriptionModels(): Promise<Record<string, ProviderModel>> {
    const response = await this.makeRequest<OpenRouterModelsResponse>('/models?output_modalities=transcription', { method: 'GET' });
    const models: Record<string, ProviderModel> = {};
    for (const model of response.data) {
      const prices = Object.values(model.pricing)
        .map((value) => parsePrice(value))
        .filter((value): value is number => value !== undefined);
      models[model.id] = {
        id: model.id,
        name: model.name,
        capabilities: ['audio'],
        freeTier: prices.length > 0 && prices.every((price) => price === 0),
      };
    }
    return models;
  }

  async listModels(): Promise<Record<string, ProviderModel>> {
    const response = await this.makeRequest<OpenRouterModelsResponse>("/models", { method: "GET" });
    const models: Record<string, ProviderModel> = {};

    for (const model of response.data) {
      const outputModalities = model.architecture.output_modalities ?? [];
      const outputFromLegacyModality = model.architecture.modality.split("->")[1]?.split("+") ?? [];
      const declaredOutputs = outputModalities.length ? outputModalities : outputFromLegacyModality;
      const capabilities: ("text" | "image" | "audio" | "vision")[] = [];
      if (declaredOutputs.includes("text")) capabilities.push("text");
      if (declaredOutputs.includes("image")) capabilities.push("image");
      if (model.architecture.input_modalities?.includes("audio")) capabilities.push("audio");

      const pricing = model.pricing;
      const promptPrice = parsePrice(pricing.prompt);
      const completionPrice = parsePrice(pricing.completion);
      const inputPrice = promptPrice === undefined ? undefined : promptPrice * 1_000_000;
      const outputPrice = completionPrice === undefined ? undefined : completionPrice * 1_000_000;
      const imagePrice = parsePrice(pricing.image);
      const requestPrice = parsePrice(pricing.request);
      const imageSpecificPrices = [
        parsePrice(pricing.image),
        parsePrice(pricing.image_token),
        parsePrice(pricing.image_output),
      ];
      const hasImageSpecificPrice = imageSpecificPrices.some((price) => price !== undefined);
      const imageRelatedPrices = [
        promptPrice,
        completionPrice,
        ...imageSpecificPrices,
        requestPrice,
      ];
      const hasZeroTextPricing = Number.isFinite(inputPrice) && inputPrice === 0
        && Number.isFinite(outputPrice) && outputPrice === 0
        && (requestPrice === undefined || requestPrice === 0);
      const hasZeroImagePricing = hasImageSpecificPrice
        && imageRelatedPrices.every((price) => price === undefined || price === 0);

      models[model.id] = {
        id: model.id,
        name: model.name,
        capabilities,
        freeTier: capabilities.includes("image") ? hasZeroImagePricing : hasZeroTextPricing,
        pricing: (inputPrice || outputPrice || imagePrice || requestPrice)
          ? {
              inputPerMillionTokens: inputPrice,
              outputPerMillionTokens: outputPrice,
              imagePerGeneration: imagePrice,
            }
          : undefined,
        maxTokens: model.top_provider?.max_completion_tokens,
        contextWindow: model.context_length,
      };
    }

    return models;
  }

  async checkHealth(): Promise<import("../types.ts").ProviderHealth> {
    try {
      await this.makeRequest("/models", { method: "GET" });
      this.health.available = true;
      this.health.consecutiveFailures = 0;
      this.health.lastSuccess = new Date();
    } catch {
      this.health.available = false;
      this.health.consecutiveFailures++;
      this.health.lastError = "Health check failed";
    }
    return this.health;
  }
}

export function createOpenRouterProvider(config: ProviderConfig): OpenRouterProvider {
  return new OpenRouterProvider(config);
}
