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

interface GeminiMessage {
  role: "user" | "model";
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
  responseMimeType?: string;
  responseSchema?: object;
  seed?: number;
}

interface GeminiRequest {
  contents: GeminiMessage[];
  generationConfig?: GeminiGenerationConfig;
  safetySettings?: Array<{ category: string; threshold: string }>;
  tools?: Array<{ functionDeclarations: Array<{ name: string; description: string; parameters: object }> }>;
  toolConfig?: { functionCallingConfig: { mode: string; allowedFunctionNames?: string[] } };
  systemInstruction?: { parts: Array<{ text: string }> };
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: Array<{ text?: string }>; role: string };
    finishReason: string;
    index: number;
    safetyRatings?: Array<{ category: string; probability: string }>;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  promptFeedback?: { safetyRatings: Array<{ category: string; probability: string }> };
}

interface ImagenRequest {
  prompt: string;
  negativePrompt?: string;
  numberOfImages?: number;
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  personGeneration?: "dont_allow" | "allow_adult";
  safetyFilterLevel?: "block_some" | "block_most" | "block_only_high";
  seed?: number;
}

interface ImagenResponse {
  images: Array<{
    image: { imageBytes: string; mimeType: string };
    enhancedPrompt?: string;
  }>;
}

interface GeminiInteractionResponse {
  id?: string;
  status?: string;
  error?: { message?: string };
  steps?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      data?: string;
      mime_type?: string;
      text?: string;
    }>;
  }>;
  output?: Array<{
    type?: string;
    data?: string;
    mime_type?: string;
    text?: string;
  }>;
  output_image?: {
    data?: string;
    mime_type?: string;
  };
}

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL?.trim() || 'gemini-3.8-flash';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-nano-banana-2.1';
const GEMINI_MODELS: Record<string, ProviderModel> = {
  [GEMINI_TEXT_MODEL]: {
    id: GEMINI_TEXT_MODEL,
    name: `Gemini text (${GEMINI_TEXT_MODEL})`,
    capabilities: ['text'],
    freeTier: process.env.AI_GEMINI_FREE_TIER_CONFIRMED === 'true',
    maxTokens: 8192,
    contextWindow: 1048576,
  },
  [GEMINI_IMAGE_MODEL]: {
    id: GEMINI_IMAGE_MODEL,
    name: `Gemini image (${GEMINI_IMAGE_MODEL})`,
    capabilities: ['image'],
    freeTier: process.env.AI_GEMINI_IMAGE_FREE_TIER_CONFIRMED === 'true',
  },
};
export class GeminiProvider extends AIProviderBase {
  readonly id: AIProviderId = "gemini";
  readonly name = "Google Gemini";
  readonly capabilities: ProviderCapability = { text: true, image: true, audio: false };
  readonly models = GEMINI_MODELS;

  constructor(config: ProviderConfig) {
    super(config);
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
      const url = this.buildUrl(endpoint);
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...this.getHeaders(),
          "x-goog-api-key": this.config.apiKey ?? "",
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

  private convertMessages(messages: AITextRequest["messages"]): GeminiMessage[] {
    return messages
      .filter((m) => m.role !== "tool")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
  }

  private convertTools(tools?: AITextRequest["tools"]): GeminiRequest["tools"] {
    if (!tools) return undefined;
    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }

  private mapFinishReason(reason: string): AITextResponse["choices"][0]["finishReason"] {
    switch (reason) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "length";
      case "TOOL_USE":
        return "tool_calls";
      case "SAFETY":
        return "content_filter";
      default:
        return "stop";
    }
  }

  async generateText(request: AITextRequest): Promise<AITextResponse> {
    this.logRequest("generateText", { model: request.model, messagesCount: request.messages.length });

    const geminiRequest: GeminiRequest = {
      contents: this.convertMessages(request.messages),
      generationConfig: {
        temperature: request.temperature,
        topP: request.topP,
        topK: request.topK,
        maxOutputTokens: request.maxTokens,
        stopSequences: request.stop,
        responseMimeType: request.responseFormat?.type === "json_object" ? "application/json" : undefined,
        seed: request.seed,
      },
      tools: this.convertTools(request.tools),
      toolConfig: request.toolChoice
        ? {
            functionCallingConfig: {
              mode: request.toolChoice === "none" ? "NONE" : "AUTO",
              allowedFunctionNames:
                request.toolChoice !== "auto" && request.toolChoice !== "none" && "function" in request.toolChoice
                  ? [request.toolChoice.function.name]
                  : undefined,
            },
          }
        : undefined,
      systemInstruction: request.messages.find((m) => m.role === "system")
        ? { parts: [{ text: request.messages.find((m) => m.role === "system")!.content }] }
        : undefined,
    };

    const modelPath = request.model.includes("imagen") ? "imagen-3.0-generate-002" : request.model;
    const endpoint = `/models/${modelPath}:generateContent`;

    const response = await this.requestWithRetry<GeminiResponse>(
      "generateText",
      () => this.makeRequest(endpoint, { method: "POST", body: JSON.stringify(geminiRequest) })
    );

    this.logResponse("generateText", { choices: response.candidates?.length ?? 0 });

    const choice = response.candidates?.[0];
    if (!choice) {
      throw new AppError(500, "PROVIDER_ERROR", "No response from Gemini", { provider: this.id });
    }

    const content = choice.content.parts.map((p) => p.text ?? "").join("");

    return {
      id: `gemini-${Date.now()}`,
      model: request.model,
      provider: this.id,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
            toolCalls: undefined,
          },
          finishReason: this.mapFinishReason(choice.finishReason),
        },
      ],
      usage: response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount,
            completionTokens: response.usageMetadata.candidatesTokenCount,
            totalTokens: response.usageMetadata.totalTokenCount,
          }
        : undefined,
      created: Math.floor(Date.now() / 1000),
    };
  }

  async generateImage(request: AIImageRequest): Promise<AIImageResponse> {
    this.logRequest("generateImage", { model: request.model, promptLength: request.prompt.length });

    if (!request.model.startsWith('imagen-')) {
      const response = await this.requestWithRetry<GeminiInteractionResponse>(
        "generateImage",
        () => this.makeRequest("/interactions", {
          method: "POST",
          body: JSON.stringify({
            model: request.model,
            input: [{ type: "text", text: request.prompt }],
            store: false,
          }),
        })
      );
      const stepContent = response.steps?.flatMap((step) => step.content ?? []) ?? [];
      const outputContent = [...(response.output ?? []), ...stepContent];
      const outputImages = outputContent
        .filter((item) => item.type === "image" && item.data)
        .map((item) => ({
          b64Json: item.data!,
          mimeType: item.mime_type || "image/png",
        }));
      if (response.output_image?.data) {
        outputImages.push({
          b64Json: response.output_image.data,
          mimeType: response.output_image.mime_type || "image/png",
        });
      }
      if (!outputImages.length) {
        const refusalText = [
          response.error?.message,
          ...outputContent.map((item) => item.text),
        ].filter((value): value is string => Boolean(value)).join(" ");
        if (isProviderSafetyRefusal(refusalText)) {
          throw new AppError(403, "SAFETY_BLOCKED", "The provider refused this request under its safety policies.");
        }
        throw new AppError(502, "AI_EMPTY_RESPONSE", "Gemini returned no generated image.");
      }
      return {
        id: response.id ?? `gemini-img-${Date.now()}`,
        model: request.model,
        provider: this.id,
        data: outputImages.map((image) => ({
          b64Json: image.b64Json,
          mimeType: image.mimeType,
        })),
        created: Math.floor(Date.now() / 1000),
        usage: { totalImages: outputImages.length },
      };
    }

    const imagenRequest: ImagenRequest = {
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      numberOfImages: request.n ?? 1,
      aspectRatio: this.mapSizeToAspectRatio(request.size),
      seed: request.seed,
    };

    const modelId = request.model === "imagen-3.0-fast-generate-001" ? "imagen-3.0-fast-generate-001" : "imagen-3.0-generate-002";
    const endpoint = `/models/${modelId}:predict`;

    const response = await this.requestWithRetry<ImagenResponse>(
      "generateImage",
      () => this.makeRequest(endpoint, { method: "POST", body: JSON.stringify(imagenRequest) })
    );

    this.logResponse("generateImage", { images: response.images?.length ?? 0 });

    return {
      id: `gemini-img-${Date.now()}`,
      model: request.model,
      provider: this.id,
      data: response.images.map((img) => ({
        url: `data:${img.image.mimeType};base64,${img.image.imageBytes}`,
        revisedPrompt: img.enhancedPrompt,
      })),
      created: Math.floor(Date.now() / 1000),
      usage: { totalImages: response.images.length },
    };
  }

  private mapSizeToAspectRatio(size?: string): ImagenRequest["aspectRatio"] {
    if (!size) return "1:1";
    const [w, h] = size.split("x").map(Number);
    if (!w || !h) return "1:1";
    const ratio = w / h;
    if (ratio >= 1.7) return "16:9";
    if (ratio >= 1.3) return "4:3";
    if (ratio <= 0.75) return "9:16";
    if (ratio <= 0.85) return "3:4";
    return "1:1";
  }

  async transcribeAudio(request: AIAudioRequest): Promise<AIAudioResponse> {
    throw new AppError(400, "NOT_SUPPORTED", "Audio transcription not supported by Gemini provider", {
      provider: this.id,
    });
  }

  async checkHealth(): Promise<import("../types.ts").ProviderHealth> {
    try {
      await this.makeRequest(`/models/${GEMINI_TEXT_MODEL}:generateContent`, {
        method: "POST",
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "health check" }] }],
          generationConfig: { maxOutputTokens: 1 },
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

export function createGeminiProvider(config: ProviderConfig): GeminiProvider {
  return new GeminiProvider(config);
}
