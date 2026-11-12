import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiConfig } from '../src/config/ai.ts';
import { getAIProviderStatus, resetAICooldowns, runAI } from '../src/services/ai/router.ts';
import { GeminiProvider } from '../src/services/ai/providers/gemini.ts';
import { CloudflareProvider } from '../src/services/ai/providers/cloudflare.ts';
import { AppError } from '../src/utils/errors.ts';

const originalProviders = { ...aiConfig.providers };
const originalAllowPaid = aiConfig.allowPaidUsage;
const freeTextModel = { id: 'test-model', name: 'Test model', capabilities: ['text' as const], freeTier: true };

afterEach(() => {
  vi.unstubAllGlobals();
  resetAICooldowns();
  Object.assign(aiConfig.providers, originalProviders);
  aiConfig.allowPaidUsage = originalAllowPaid;
});

describe('AI provider fallback', () => {
  it('uses the Cloudflare /ai/run endpoint for text, image, and transcription', async () => {
    const requestedUrls: string[] = [];
    const responses = [
      { success: true, result: { response: 'A generated message.' } },
      { success: true, result: { image: '/9j/4AAQSkZJRgABAQAAAQABAAD/' } },
      { success: true, result: { text: 'A transcribed message.' } },
    ];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      const body = responses.shift();
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const provider = new CloudflareProvider({
      apiKey: 'test-token',
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/test-account/ai',
      models: {},
      timeout: 1000,
      maxRetries: 0,
      retryDelayMs: 100,
    });

    await provider.generateText({
      model: '@cf/meta/llama-3.2-3b-instruct',
      messages: [{ role: 'user', content: 'Write a greeting.' }],
    });
    await provider.generateImage({
      model: '@cf/black-forest-labs/flux-1-schnell',
      prompt: 'A fox sticker.',
    });
    await provider.transcribeAudio({
      model: '@cf/openai/whisper',
      audio: Buffer.alloc(44).toString('base64'),
      mimeType: 'audio/wav',
    });

    expect(requestedUrls).toEqual([
      'https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/@cf/meta/llama-3.2-3b-instruct',
      'https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/@cf/black-forest-labs/flux-1-schnell',
      'https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/@cf/openai/whisper',
    ]);
  });

  it('uses the Gemini Interactions API to return generated image data', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({
        id: 'interaction-1',
        output: [{ type: 'image', data: 'aGVsbG8=', mime_type: 'image/png' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new GeminiProvider({
      apiKey: 'test-secret',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      models: {},
      timeout: 1000,
      maxRetries: 0,
      retryDelayMs: 100,
    });

    const response = await provider.generateImage({
      model: 'gemini-nano-banana-2.1',
      prompt: 'A smiling fox sticker',
      n: 1,
      responseFormat: 'b64_json',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect((options?.headers as Record<string, string>)['x-goog-api-key']).toBe('test-secret');
    expect(JSON.parse(String(options?.body))).toEqual({
      model: 'gemini-nano-banana-2.1',
      input: [{ type: 'text', text: 'A smiling fox sticker' }],
      store: false,
    });
    expect(response.data[0]).toMatchObject({ b64Json: 'aGVsbG8=', mimeType: 'image/png' });
  });

  it('routes Gemini image requests only when its configured image model is eligible', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = {
      models: {
        'gemini-nano-banana-2.1': {
          id: 'gemini-nano-banana-2.1',
          name: 'Gemini image',
          capabilities: ['image'],
          freeTier: true,
        },
      },
      timeout: 1000,
      maxRetries: 0,
      retryDelayMs: 100,
    };
    aiConfig.providers.grok = aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;

    const answer = await runAI('image', async (_provider, model) => model);

    expect(answer).toMatchObject({
      provider: 'gemini',
      model: 'gemini-nano-banana-2.1',
      result: 'gemini-nano-banana-2.1',
    });
  });

  it('falls back after an access-denied provider response', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.grok = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;
    const attempts: string[] = [];

    const answer = await runAI('text', async (provider) => {
      attempts.push(provider.id);
      if (provider.id === 'gemini') throw new AppError(403, 'PROVIDER_ACCESS_DENIED', 'Provider access denied');
      return 'access fallback worked';
    });

    expect(attempts).toEqual(['gemini', 'grok']);
    expect(answer.provider).toBe('grok');
  });

  it('normalizes image safety refusals so fallback cannot bypass provider policy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'Request blocked by the safety policy.' },
    }), { status: 403, headers: { 'Content-Type': 'application/json' } })));
    const provider = new GeminiProvider({
      apiKey: 'test-secret',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      models: {},
      timeout: 1000,
      maxRetries: 0,
      retryDelayMs: 100,
    });

    await expect(provider.generateImage({
      model: 'gemini-nano-banana-2.1',
      prompt: 'A sticker',
    })).rejects.toMatchObject({ code: 'SAFETY_BLOCKED' });
  });

  it('moves to the next eligible provider after a simulated rate limit', async () => {
    aiConfig.providers.gemini = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.grok = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.cloudflare = null;
    aiConfig.providers.openrouter = null;
    const attempts: string[] = [];

    const answer = await runAI('text', async (provider) => {
      attempts.push(provider.id);
      if (provider.id === 'gemini') throw new Response(null, { status: 429, headers: { 'Retry-After': '0' } });
      return 'simulated success';
    });

    expect(attempts).toEqual(['gemini', 'grok']);
    expect(answer).toMatchObject({ provider: 'grok', model: 'test-model', result: 'simulated success' });
  });

  it('does not select paid models when paid usage is disabled', async () => {
    const previous = aiConfig.allowPaidUsage;
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = {
      models: { paid: { ...freeTextModel, id: 'paid', freeTier: false } },
      timeout: 1000, maxRetries: 0, retryDelayMs: 100,
    };
    aiConfig.providers.grok = aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;
    await expect(runAI('text', async () => 'should not run')).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    aiConfig.allowPaidUsage = previous;
  });

  it('uses live OpenRouter image capabilities and chooses an explicitly free model', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = aiConfig.providers.grok = aiConfig.providers.cloudflare = null;
    aiConfig.providers.openrouter = {
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.example/api/v1',
      models: {},
      timeout: 1000,
      maxRetries: 0,
      retryDelayMs: 100,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          id: 'test/paid-image',
          name: 'Paid image model',
          description: '',
          pricing: { prompt: '0', completion: '0', image: '0.02', request: '0' },
          context_length: 4096,
          architecture: { modality: 'text->image', input_modalities: ['text'], output_modalities: ['image'] },
          top_provider: { max_completion_tokens: 1024, is_moderated: true },
        },
        {
          id: 'test/ambiguous-free-image',
          name: 'Image model with hidden output pricing',
          description: '',
          pricing: { prompt: '0', completion: '0', image: '0', image_output: '0.00006', request: '0' },
          context_length: 4096,
          architecture: { modality: 'text->image', input_modalities: ['text'], output_modalities: ['image'] },
          top_provider: { max_completion_tokens: 1024, is_moderated: true },
        },
        {
          id: 'test/free-image',
          name: 'Free image model',
          description: '',
          pricing: { prompt: '0', completion: '0', image: '0', image_output: '0', request: '0' },
          context_length: 4096,
          architecture: { modality: 'text->image', input_modalities: ['text'], output_modalities: ['image'] },
          top_provider: { max_completion_tokens: 1024, is_moderated: true },
        },
        {
          id: 'test/text-only',
          name: 'Text-only model with image input',
          description: '',
          pricing: { prompt: '0', completion: '0', request: '0' },
          context_length: 4096,
          architecture: { modality: 'text+image->text', input_modalities: ['text', 'image'], output_modalities: ['text'] },
          top_provider: { max_completion_tokens: 1024, is_moderated: true },
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await runAI('image', async (_provider, model) => model);
    expect(result).toMatchObject({ provider: 'openrouter', model: 'test/free-image', result: 'test/free-image' });
  });

  it('does not call a paid OpenRouter image model when paid usage is disabled', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = aiConfig.providers.grok = aiConfig.providers.cloudflare = null;
    aiConfig.providers.openrouter = {
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.example/api/v1',
      models: {},
      timeout: 1000,
      maxRetries: 0,
      retryDelayMs: 100,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: 'test/paid-image',
        name: 'Paid image model',
        description: '',
        pricing: { prompt: '0', completion: '0', image: '0.02', request: '0' },
        context_length: 4096,
        architecture: { modality: 'text->image', input_modalities: ['text'], output_modalities: ['image'] },
        top_provider: { max_completion_tokens: 1024, is_moderated: true },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const invoke = vi.fn(async () => 'must not be called');

    await expect(runAI('image', invoke)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([402, 503])('falls back after simulated HTTP %s quota or service failure', async (status) => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.grok = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;
    const answer = await runAI('text', async (provider) => {
      if (provider.id === 'gemini') throw new Response(null, { status });
      return 'fallback worked';
    });
    expect(answer.provider).toBe('grok');
  });

  it('falls back after a simulated network timeout', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.grok = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;
    const answer = await runAI('text', async (provider) => {
      if (provider.id === 'gemini') throw new TypeError('fetch failed');
      return 'timeout fallback worked';
    });
    expect(answer.provider).toBe('grok');
  });

  it('falls back after simulated invalid provider credentials', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.grok = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;
    const attempts: string[] = [];

    const answer = await runAI('text', async (provider) => {
      attempts.push(provider.id);
      if (provider.id === 'gemini') throw new Response(null, { status: 401 });
      return 'credential fallback worked';
    });

    expect(attempts).toEqual(['gemini', 'grok']);
    expect(answer.provider).toBe('grok');
  });

  it('respects Retry-After and cools down only the failing capability', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.grok = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;

    await runAI('text', async (provider) => {
      if (provider.id === 'gemini') throw new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
      return 'fallback worked';
    });

    const status = await getAIProviderStatus();
    const gemini = status.find((provider) => provider.id === 'gemini');
    expect(gemini?.availability.text.temporarilyUnavailable).toBe(true);
    expect(gemini?.availability.image.temporarilyUnavailable).toBe(false);
    expect(gemini?.availability.text.availableAfter).not.toBeNull();
  });

  it('does not fall back after an explicit safety refusal', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.grok = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;
    const attempts: string[] = [];

    await expect(runAI('text', async (provider) => {
      attempts.push(provider.id);
      throw new AppError(403, 'SAFETY_BLOCKED', 'Provider safety refusal');
    })).rejects.toMatchObject({ code: 'SAFETY_BLOCKED' });
    expect(attempts).toEqual(['gemini']);
  });

  it('does not call providers that have no matching capability', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.grok = aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;
    const invoke = vi.fn(async () => 'must not be called');
    await expect(runAI('audio', invoke)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('returns a clear all-providers-unavailable error', async () => {
    aiConfig.allowPaidUsage = false;
    aiConfig.providers.gemini = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.grok = { models: { 'test-model': freeTextModel }, timeout: 1000, maxRetries: 0, retryDelayMs: 100 };
    aiConfig.providers.cloudflare = aiConfig.providers.openrouter = null;
    await expect(runAI('text', async () => { throw new Response(null, { status: 503 }); })).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: expect.stringContaining('Provider status:'),
    });
  });
});
