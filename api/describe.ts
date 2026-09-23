// api/describe.ts — Vercel adapter for Gemini description generation.

import { handleGemini } from '../server/geminiHandler';

export default async function handler(req: any, res: any) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const { status, body } = await handleGemini(req.method, req.body, process.env, ip);
  res.status(status).json(body);
}
