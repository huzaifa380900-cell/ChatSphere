import { logger } from "../../../config/logger.ts";
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

interface GrokMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface GrokRequest {
  model: string;
  messages: GrokMessage[];
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
}

interface GrokResponse {
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

interface GrokImageRequest {
  model: string;
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  resolution?: "1k" | "2k";
  quality?: "low" | "medium" | "auto";
  response_format?: "url" | "b64_json";
}

interface GrokImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

const GROK_MODELS: Record<string, ProviderModel> = {
  "grok-4.7": {
    id: "grok-4.7",
    name: "Grok 4.7",
    capabilities: ["text"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
  },
  "grok-beta": {
    id: "grok-beta",
    name: "Grok Beta",
    capabilities: ["text"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 5, outputPerMillionTokens: 15 },
    maxTokens: 8192,
    contextWindow: 131072,
  },
  "grok-vision-beta": {
    id: "grok-vision-beta",
    name: "Grok Vision Beta",
    capabilities: ["text", "vision"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 5, outputPerMillionTokens: 15 },
    maxTokens: 8192,
    contextWindow: 131072,
  },
  "grok-2-1212": {
    id: "grok-2-1212",
    name: "Grok 2 (Dec 12)",
    capabilities: ["text", "vision"],
    freeTier: false,
    pricing: { inputPerMillionTokens: 5, outputPerMillionTokens: 15 },
    maxTokens: 8192,
    contextWindow: 131072,
  },
  "grok-imagine-image-2.0": {
    id: "grok-imagine-image-2.0",
    name: "Grok Imagine Image 2.0",
    capabilities: ["image"],
    freeTier: false,
    pricing: { imagePerGeneration: 0.02 },
  },
};

export class GrokProvider extends AIProviderBase {
  readonly id: AIProviderId = "grok";
  readonly name = "xAI Grok";
  readonly capabilities: ProviderCapability = { text: true, image: true, audio: false };
  readonly models = GROK_MODELS;

  constructor(config: ProviderConfig) {
    super(config);
  }

  protected getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
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

  private convertMessages(messages: AITextRequest["messages"]): GrokMessage[] {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
      name: m.name,
      tool_calls: m.toolCalls,
    }));
  }

  async generateText(request: AITextRequest): Promise<AITextResponse> {
    this.logRequest("generateText", { model: request.model, messagesCount: request.messages.length });

    const grokRequest: GrokRequest = {
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

    const response = await this.requestWithRetry<GrokResponse>(
      "generateText",
      () => this.makeRequest("/chat/completions", { method: "POST", body: JSON.stringify(grokRequest) })
    );

    this.logResponse("generateText", { choices: response.choices?.length ?? 0 });

    const choice = response.choices?.[0];
    if (!choice) {
      throw new AppError(500, "PROVIDER_ERROR", "No response from Grok", { provider: this.id });
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

    const grokRequest: GrokImageRequest = {
      model: request.model,
      prompt: request.prompt,
      n: request.n ?? 1,
      aspect_ratio: request.aspectRatio ?? "1:1",
      resolution: request.resolution ?? "1k",
      quality: request.quality,
      response_format: request.responseFormat,
    };

    const response = await this.requestWithRetry<GrokImageResponse>(
      "generateImage",
      () => this.makeRequest("/images/generations", { method: "POST", body: JSON.stringify(grokRequest) })
    );

    this.logResponse("generateImage", { images: response.data?.length ?? 0 });

    return {
      id: `grok-img-${Date.now()}`,
      model: request.model,
      provider: this.id,
      data: response.data.map((img) => ({
        url: img.url,
        b64Json: img.b64_json,
        revisedPrompt: img.revised_prompt,
      })),
      created: response.created,
      usage: { totalImages: response.data.length },
    };
  }

  async transcribeAudio(request: AIAudioRequest): Promise<AIAudioResponse> {
    throw new AppError(400, "NOT_SUPPORTED", "Audio transcription not supported by Grok provider", {
      provider: this.id,
    });
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

export function createGrokProvider(config: ProviderConfig): GrokProvider {
  return new GrokProvider(config);
}
