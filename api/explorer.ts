// api/explorer.ts — Vercel adapter. All logic lives in server/explorerHandler.ts
// so the Vite dev server can run the identical code path locally.

import { handleExplorer } from '../server/explorerHandler.js';

export default async function handler(req: any, res: any) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const { status, body } = await handleExplorer(
    { method: req.method, query: req.query },
    process.env,
    ip
  );

  // Explorer history is stable enough to cache briefly at the edge, which
  // takes repeat lookups of the same wallet off our rate limit entirely.
  if (status === 200) {
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
  }
  res.status(status).json(body);
}
