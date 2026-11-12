import { logger } from "../../../config/logger.ts";
import { AppError } from "../../../utils/errors.ts";
import { AIProviderBase, isProviderSafetyRefusal } from "./base.ts";
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

interface CloudflareTextRequest {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

interface CloudflareTextResponse {
  result: {
    response: string;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  messages?: Array<{ code: number; message: string }>;
}

interface CloudflareImageRequest {
  prompt: string;
  negative_prompt?: string;
  num_images?: number;
  width?: number;
  height?: number;
  steps?: number;
  guidance_scale?: number;
  seed?: number;
}

interface CloudflareImageResponse {
  result: {
    image: string;
    prompt?: string;
  };
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
}

interface CloudflareAudioRequest {
  audio: string;
  language?: string;
  task?: "transcribe" | "translate";
  vad_filter?: boolean;
}

interface CloudflareAudioResponse {
  result: {
    text: string;
    language?: string;
    duration?: number;
    segments?: Array<{
      id: number;
      start: number;
      end: number;
      text: string;
      words?: Array<{ word: string; start: number; end: number; confidence: number }>;
    }>;
  };
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
}

const CLOUDFLARE_MODELS: Record<string, ProviderModel> = {
  "@cf/meta/llama-3.1-8b-instruct": {
    id: "@cf/meta/llama-3.1-8b-instruct",
    name: "Llama 3.1 8B Instruct",
    capabilities: ["text"],
    freeTier: true,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  "@cf/meta/llama-3.1-70b-instruct": {
    id: "@cf/meta/llama-3.1-70b-instruct",
    name: "Llama 3.1 70B Instruct",
    capabilities: ["text"],
    freeTier: true,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  "@cf/mistral/mistral-7b-instruct-v0.2": {
    id: "@cf/mistral/mistral-7b-instruct-v0.2",
    name: "Mistral 7B Instruct v0.2",
    capabilities: ["text"],
    freeTier: true,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  "@cf/google/gemma-7b-it": {
    id: "@cf/google/gemma-7b-it",
    name: "Gemma 7B IT",
    capabilities: ["text"],
    freeTier: true,
    maxTokens: 4096,
    contextWindow: 8192,
  },
  "@cf/black-forest-labs/flux-1-schnell": {
    id: "@cf/black-forest-labs/flux-1-schnell",
    name: "FLUX.1 Schnell",
    capabilities: ["image"],
    freeTier: true,
  },
  "@cf/stabilityai/stable-diffusion-xl-base-1.0": {
    id: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    name: "Stable Diffusion XL Base 1.0",
    capabilities: ["image"],
    freeTier: true,
  },
  "@cf/openai/whisper": {
    id: "@cf/openai/whisper",
    name: "Whisper (Speech-to-Text)",
    capabilities: ["audio"],
    freeTier: true,
    pricing: { audioPerSecond: 0.0001 },
  },
  "@cf/openai/whisper-tiny": {
    id: "@cf/openai/whisper-tiny",
    name: "Whisper Tiny (Speech-to-Text)",
    capabilities: ["audio"],
    freeTier: true,
    pricing: { audioPerSecond: 0.00005 },
  },
};

export class CloudflareProvider extends AIProviderBase {
  readonly id: AIProviderId = "cloudflare";
  readonly name = "Cloudflare Workers AI";
  readonly capabilities: ProviderCapability = { text: true, image: true, audio: true };
  readonly models = CLOUDFLARE_MODELS;

  private accountId: string;

  constructor(config: ProviderConfig) {
    super(config);
    const url = config.baseUrl ?? "";
    const match = url.match(/accounts\/([^/]+)\/ai/);
    this.accountId = match?.[1] ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
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
    const timeoutMs = timeout ?? this.config.timeout ?? 120000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = this.buildUrl(endpoint);
      const response = await fetch(url, {
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

      const data = (await response.json()) as T;
      const result = data as { success?: boolean; errors?: Array<{ code: number; message: string }> };
      if (result.success === false) {
        const errorMsg = result.errors?.map((e) => e.message).join(", ") ?? "Unknown error";
        if (isProviderSafetyRefusal(errorMsg)) {
          throw new AppError(403, "SAFETY_BLOCKED", "The provider refused this request under its safety policies.");
        }
        throw new AppError(503, "PROVIDER_ERROR", `Cloudflare API error: ${errorMsg}`, {
          provider: this.id,
        });
      }
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TypeError("fetch timeout");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private convertMessages(messages: AITextRequest["messages"]): CloudflareTextRequest["messages"] {
    return messages
      .filter((m) => m.role !== "tool")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
        content: m.content,
      }));
  }

  async generateText(request: AITextRequest): Promise<AITextResponse> {
    this.logRequest("generateText", { model: request.model, messagesCount: request.messages.length });

    const cfRequest: CloudflareTextRequest = {
      messages: this.convertMessages(request.messages),
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      top_p: request.topP,
      stream: request.stream ?? false,
    };

    const response = await this.requestWithRetry<CloudflareTextResponse>(
      "generateText",
      () => this.makeRequest(`/run/${request.model}`, {
        method: "POST",
        body: JSON.stringify(cfRequest),
      })
    );

    this.logResponse("generateText", { hasResponse: !!response.result?.response });

    const text = response.result?.response ?? "";
    const usage = response.result?.usage;

    return {
      id: `cf-${Date.now()}`,
      model: request.model,
      provider: this.id,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finishReason: "stop",
        },
      ],
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          }
        : undefined,
      created: Math.floor(Date.now() / 1000),
    };
  }

  async generateImage(request: AIImageRequest): Promise<AIImageResponse> {
    this.logRequest("generateImage", { model: request.model, promptLength: request.prompt.length });

    const [width, height] = this.parseSize(request.size);
    const cfRequest: CloudflareImageRequest = {
      prompt: request.prompt,
      negative_prompt: request.negativePrompt,
      num_images: request.n ?? 1,
      width,
      height,
      steps: request.model.includes("flux") ? 4 : 25,
      seed: request.seed,
    };

    const modelEndpoint = `/run/${request.model}`;
    const imagePayload = request.model.includes('flux')
      ? { prompt: request.prompt, steps: Math.min(request.model.includes('flux') ? 4 : 25, 8), seed: request.seed }
      : cfRequest;

    const response = await this.requestWithRetry<CloudflareImageResponse>(
      "generateImage",
      () => this.makeRequest(modelEndpoint, { method: "POST", body: JSON.stringify(imagePayload) })
    );

    this.logResponse("generateImage", { hasImage: !!response.result?.image });

    const imageData = response.result?.image;
    if (!imageData) {
      throw new AppError(500, "PROVIDER_ERROR", "No image returned from Cloudflare", { provider: this.id });
    }

    return {
      id: `cf-img-${Date.now()}`,
      model: request.model,
      provider: this.id,
      data: [
        {
          url: `data:image/jpeg;base64,${imageData}`,
          mimeType: 'image/jpeg',
          revisedPrompt: response.result?.prompt,
        },
      ],
      created: Math.floor(Date.now() / 1000),
      usage: { totalImages: cfRequest.num_images ?? 1 },
    };
  }

  async transcribeAudio(request: AIAudioRequest): Promise<AIAudioResponse> {
    this.logRequest("transcribeAudio", { model: request.model, audioLength: request.audio.length });

    const audioBytes = Buffer.from(request.audio, 'base64');
    const modelEndpoint = `/run/${request.model}`;

    const response = await this.requestWithRetry<CloudflareAudioResponse>(
      "transcribeAudio",
      () => this.makeRequest(modelEndpoint, {
        method: "POST",
        body: audioBytes,
        headers: { 'Content-Type': request.mimeType || 'application/octet-stream' },
      })
    );

    this.logResponse("transcribeAudio", { hasText: !!response.result?.text });

    const result = response.result;
    if (!result) {
      throw new AppError(500, "PROVIDER_ERROR", "No transcription returned from Cloudflare", {
        provider: this.id,
      });
    }

    return {
      id: `cf-audio-${Date.now()}`,
      model: request.model,
      provider: this.id,
      text: result.text,
      language: result.language,
      duration: result.duration,
      words: result.segments?.flatMap((s) =>
        s.words?.map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
        })) ?? []
      ),
      segments: result.segments?.map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        text: s.text,
        words: s.words?.map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
        })),
      })),
      created: Math.floor(Date.now() / 1000),
    };
  }

  private parseSize(size?: string): [number, number] {
    if (!size) return [1024, 1024];
    const [w, h] = size.split("x").map(Number);
    if (!w || !h) return [1024, 1024];
    return [w, h];
  }

  async checkHealth(): Promise<import("../types.ts").ProviderHealth> {
    try {
      await this.makeRequest("/@cf/meta/llama-3.1-8b-instruct", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "health check" }],
          max_tokens: 1,
        }),
      });
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

export function createCloudflareProvider(config: ProviderConfig): CloudflareProvider {
  return new CloudflareProvider(config);
}
