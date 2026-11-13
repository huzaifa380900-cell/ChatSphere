import { vercelHandler } from '../server/dist/src/vercel-handler.js';
import type { vercelHandler as sourceVercelHandler } from '../server/src/vercel-handler.ts';

type ApiRequest = Parameters<typeof sourceVercelHandler>[0];
type ApiResponse = Parameters<typeof sourceVercelHandler>[1];

export default function handler(req: ApiRequest, res: ApiResponse): void {
  const routePath = req.query.__path;
  if (
    typeof routePath !== 'string' ||
    routePath.length === 0 ||
    routePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_API_PATH',
        message: 'The requested API path is invalid.',
      },
    });
    return;
  }

  const incomingUrl = new URL(req.url || '/', 'https://vercel.local');
  incomingUrl.searchParams.delete('__path');
  req.url = `/api/${routePath}${incomingUrl.search}`;
  vercelHandler(req, res);
}
