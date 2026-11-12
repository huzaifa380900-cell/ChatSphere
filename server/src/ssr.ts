/**
 * Vite SSR middleware for ChatSphere.
 *
 * Development: uses Vite dev server (vite.createServer) to transform files on-the-fly.
 * Production:  serves pre-built static files from client/dist and loads the SSR bundle.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Express, Request, Response, NextFunction } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const clientRootCandidates = [
  path.resolve(process.cwd(), 'client'),
  path.resolve(process.cwd(), '../client'),
  path.resolve(__dirname, '../../client'),
  path.resolve(__dirname, '../../../client'),
];
function findClientRoot(): string {
  const root = clientRootCandidates.find((candidate) =>
    fs.existsSync(path.resolve(candidate, 'index.html'))
  );
  if (!root) {
    throw new Error('Client application directory could not be located for SSR.');
  }
  return root;
}
const clientRoot = findClientRoot();
const clientDist = path.resolve(clientRoot, 'dist');
const ssrOutlet = '<!--ssr-outlet-->';

function injectRenderedApp(template: string, appHtml: string): string {
  if (!template.includes(ssrOutlet)) {
    throw new Error(`SSR template is missing the ${ssrOutlet} marker.`);
  }
  return template.replace(ssrOutlet, appHtml);
}

/**
 * Register SSR middleware on the Express app.
 * Call this AFTER all /api routes.
 */
export async function registerSsrMiddleware(app: Express): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    // ── DEVELOPMENT MODE ────────────────────────────────────────────────────
    // Spin up a Vite dev server in middleware mode and let it handle HMR,
    // file transforms, and module loading.
    const { createServer: createViteServer } = await import('vite');

    const vite = await createViteServer({
      root: clientRoot,
      server: { middlewareMode: true },
      appType: 'custom', // we handle HTML ourselves
    });

    // Let Vite handle JS/CSS/asset requests
    app.use(vite.middlewares);

    // SSR catch-all: render every non-API route server-side
    app.get('*', async (req: Request, res: Response, next: NextFunction) => {
      const url = req.originalUrl;
      try {
        // 1. Read and transform the HTML template
        let template = await fs.promises.readFile(path.resolve(clientRoot, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);

        // 2. Load the server entry module (always fresh in dev)
        const { render } = (await vite.ssrLoadModule('/src/entry-server.tsx')) as {
          render: (url: string) => Promise<string>;
        };

        // 3. Render the app to an HTML string
        const appHtml = await render(url);

        // 4. Inject the rendered HTML into the template
        const html = injectRenderedApp(template, appHtml);

        res.status(200).setHeader('Content-Type', 'text/html').end(html);
      } catch (err) {
        // Let Vite fix the stack trace for better DX
        if (err instanceof Error) vite.ssrFixStacktrace(err);
        next(err);
      }
    });
  } else {
    // ── PRODUCTION MODE ──────────────────────────────────────────────────────
    // Serve pre-built static assets and use the compiled SSR bundle.
    const { default: sirv } = await import('sirv');

    const clientAssets = path.resolve(clientDist, 'client');
    const serverBundle = path.resolve(clientDist, 'server', 'entry-server.js');

    // Serve static assets (JS, CSS, images, etc.)
    app.use(sirv(clientAssets, { extensions: [], dev: false }));

    // Load the pre-built render function once
    const { render } = (await import(pathToFileURL(serverBundle).href)) as {
      render: (url: string) => Promise<string>;
    };

    const template = await fs.promises.readFile(path.resolve(clientAssets, 'index.html'), 'utf-8');

    app.get('*', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const appHtml = await render(req.originalUrl);
        const html = injectRenderedApp(template, appHtml);
        res.status(200).setHeader('Content-Type', 'text/html').end(html);
      } catch (err) {
        next(err);
      }
    });
  }
}
