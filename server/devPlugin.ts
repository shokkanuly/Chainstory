// server/devPlugin.ts
//
// Runs the production API handlers inside the Vite dev server, so `npm run dev`
// behaves exactly like the deployed build. Without this, local development
// would need a second process or a different code path, and the usual result of
// a different code path is a bug that only appears in production.
//
// Keys are read from process.env, never from VITE_* variables, so nothing here
// can leak into the client bundle.

import type { Plugin } from 'vite';
import { handleExplorer } from './explorerHandler.ts';
import { handleGemini } from './geminiHandler.ts';

function readBody(req: any): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk;
      // Descriptions are small; refuse anything that is not.
      if (raw.length > 16_384) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

export function apiDevServer(): Plugin {
  return {
    name: 'chainstory-api-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();

        const ip = req.socket?.remoteAddress ?? 'local';
        const query: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
          query[key] = value;
        });

        let result;
        if (url.pathname === '/api/explorer') {
          result = await handleExplorer({ method: req.method ?? 'GET', query }, process.env, ip);
        } else if (url.pathname === '/api/describe') {
          const body = await readBody(req);
          result = await handleGemini(req.method ?? 'POST', body, process.env, ip);
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }

        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(result.body));
      });
    },
  };
}
