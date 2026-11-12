import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runAI: vi.fn(),
  getAIProviderStatus: vi.fn(() => []),
}));

vi.mock('../src/services/ai/router.ts', () => mocks);
vi.mock('../src/config/ai.ts', () => ({ aiConfig: { allowPaidUsage: false } }));
vi.mock('../src/middleware/security.ts', () => ({
  errorHandler: (error: any, _req: express.Request, res: express.Response) => res.status(error?.statusCode ?? 400).json({ success: false, error: { code: error?.code ?? 'VALIDATION_ERROR' } }),
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.header('x-test-auth') !== 'signed-in') return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } });
    next();
  },
  requireCsrf: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.header('x-test-csrf') !== 'valid') return res.status(403).json({ success: false, error: { code: 'CSRF_INVALID', message: 'Invalid CSRF token.' } });
    next();
  },
  uploadRateLimiter: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { errorHandler } from '../src/middleware/security.ts';
import { aiRouter } from '../src/routes/ai.routes.ts';

async function invoke(method: string, path: string, body?: unknown, authenticated = true, csrf = true) {
  const headers: Record<string, string> = {};
  if (authenticated) headers['x-test-auth'] = 'signed-in';
  if (csrf) headers['x-test-csrf'] = 'valid';
  const req = {
    method, url: path, originalUrl: `/api/ai${path}`, baseUrl: '/api/ai', body, headers,
    header(name: string) { return headers[name.toLowerCase()]; },
  } as unknown as express.Request;
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => { finish = resolve; });
  const response: { statusCode: number; body?: unknown; status(code: number): unknown; json(value: unknown): unknown } = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; finish(); return this; },
  };
  (aiRouter as any).handle(req, response as unknown as express.Response, (error?: unknown) => {
    if (error) {
      errorHandler(error as Error, req, response as unknown as express.Response, () => undefined);
    }
  });
  await completed;
  return response as { statusCode: number; body: { data?: any; error?: { code: string } } };
}

beforeEach(() => mocks.runAI.mockReset());

describe('AI feature API endpoints', () => {
  it('requires authentication and CSRF protection', async () => {
    expect((await invoke('GET', '/status', undefined, false)).statusCode).toBe(401);
    expect((await invoke('POST', '/text', { instruction: 'hello' }, true, false)).statusCode).toBe(403);
  });

  it('generates writer output using only validated request fields', async () => {
    mocks.runAI.mockResolvedValue({
      result: { choices: [{ message: { content: 'Hello there!' } }] },
      provider: 'gemini', model: 'gemini-3.8-flash',
    });
    const response = await invoke('POST', '/text', { instruction: 'Greet the team', action: 'write', tone: 'friendly' });
    expect(response.statusCode).toBe(200);
    expect(response.body.data?.text).toBe('Hello there!');
    expect(mocks.runAI).toHaveBeenCalledWith('text', expect.any(Function));
  });

  it('rejects empty writer output and marks the provider attempt as failed', async () => {
    mocks.runAI.mockResolvedValue({
      result: { choices: [{ message: { content: '' } }] },
      provider: 'gemini',
      model: 'empty-model',
    });
    const response = await invoke('POST', '/text', { instruction: 'Say hello' });
    expect(response.statusCode).toBe(502);
    expect(response.body.error?.code).toBe('AI_EMPTY_RESPONSE');
    const [, providerAttempt] = mocks.runAI.mock.calls[0];
    await expect(providerAttempt({
      generateText: async () => ({ choices: [{ message: { content: '' } }] }),
    }, 'empty-model')).rejects.toMatchObject({ code: 'AI_EMPTY_RESPONSE' });
  });

  it('rejects malformed writer and image requests before provider routing', async () => {
    expect((await invoke('POST', '/text', { instruction: 'draft', action: 'invented' })).statusCode).toBe(400);
    expect((await invoke('POST', '/image', { prompt: 'x', style: 'pixel' })).statusCode).toBe(400);
    expect(mocks.runAI).not.toHaveBeenCalled();
  });

  it('returns a real provider image result for preview and download clients', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=';
    mocks.runAI.mockResolvedValue({
      result: `data:image/png;base64,${png}`,
      provider: 'cloudflare',
      model: '@cf/black-forest-labs/flux-1-schnell',
    });
    const response = await invoke('POST', '/image', { prompt: 'A fox astronaut', style: 'anime' });
    expect(response.statusCode).toBe(200);
    expect(response.body.data?.image).toBe(`data:image/png;base64,${png}`);
    const [, providerAttempt] = mocks.runAI.mock.calls[0];
    await expect(providerAttempt({
      generateImage: async () => ({ data: [{ b64Json: png, mimeType: 'image/png' }] }),
    }, '@cf/black-forest-labs/flux-1-schnell')).resolves.toBe(`data:image/png;base64,${png}`);
  });

  it('rejects malformed image payloads inside the provider callback', async () => {
    mocks.runAI.mockResolvedValue({ result: 'unused', provider: 'cloudflare', model: 'invalid-image-model' });
    await invoke('POST', '/image', { prompt: 'A fox astronaut' });
    const [, providerAttempt] = mocks.runAI.mock.calls[0];
    await expect(providerAttempt({
      generateImage: async () => ({ data: [{ b64Json: 'aGVsbG8=', mimeType: 'image/png' }] }),
    }, 'invalid-image-model')).rejects.toMatchObject({ code: 'AI_INVALID_IMAGE' });
  });

  it('rejects unsupported audio formats and mismatched file signatures', async () => {
    const audio = Buffer.from('sample data long enough for validation').toString('base64');
    expect((await invoke('POST', '/transcribe', { audio, mimeType: 'video/mp4' })).statusCode).toBe(415);
    expect((await invoke('POST', '/transcribe', { audio, mimeType: 'audio/wav' })).statusCode).toBe(415);
    expect(mocks.runAI).not.toHaveBeenCalled();
  });

  it('returns editable transcript text from the configured speech model', async () => {
    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0, 'ascii');
    wav.write('WAVE', 8, 'ascii');
    mocks.runAI.mockResolvedValue({ result: { text: 'Turn left at the next street.' }, provider: 'cloudflare', model: '@cf/openai/whisper' });
    const response = await invoke('POST', '/transcribe', { audio: wav.toString('base64'), mimeType: 'audio/wav' });
    expect(response.statusCode).toBe(200);
    expect(response.body.data?.text).toBe('Turn left at the next street.');
    expect(mocks.runAI).toHaveBeenCalledWith('audio', expect.any(Function));
  });

});
