// Gemini descriptions were silently broken twice: retired model names, and a
// token budget that current "thinking" models exhaust before they answer. These
// pin the behaviour that makes both failures safe.

import { describe, expect, it, vi } from 'vitest';
import { handleGemini } from '../geminiHandler.js';

const ENV = { GEMINI_API_KEY: 'test-key' };
const BODY = { category: 'trade', ethValue: 2, usdValue: 6800, methodLabel: 'swapExactETHForTokens' };

const reply = (status: number, payload: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as unknown as Response;
const answer = (text: string, finishReason = 'STOP') =>
  reply(200, { candidates: [{ finishReason, content: { parts: [{ text }] } }] });

let ip = 0;
const call = (fetchImpl: typeof fetch) => handleGemini('POST', BODY, ENV, `t${++ip}`, fetchImpl);

describe('gemini description handler', () => {
  it('falls through retired (404) and overloaded (503) models to one that answers', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(404, { error: { message: 'no longer available' } }))
      .mockResolvedValueOnce(reply(503, { error: { message: 'high demand' } }))
      .mockResolvedValueOnce(answer('{"description":"Swapped 2 ETH for USDC."}'));
    const res = await call(f as unknown as typeof fetch);
    expect(res).toEqual({ status: 200, body: { description: 'Swapped 2 ETH for USDC.' } });
    expect(f).toHaveBeenCalledTimes(3);
  });

  // Regression: a truncated reply ("Here is", "H") reached users.
  it('never returns a fragment: a MAX_TOKENS stop moves on to the next model', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(answer('Here is', 'MAX_TOKENS'))
      .mockResolvedValueOnce(answer('{"description":"Swapped 2 ETH for USDC."}'));
    const res = await call(f as unknown as typeof fetch);
    expect(res.body).toEqual({ description: 'Swapped 2 ETH for USDC.' });
  });

  it('ignores the model’s reasoning parts', async () => {
    const f = vi.fn().mockResolvedValueOnce(
      reply(200, {
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'Let me think…', thought: true }, { text: '{"description":"Claimed rewards."}' }] },
          },
        ],
      })
    );
    expect((await call(f as unknown as typeof fetch)).body).toEqual({ description: 'Claimed rewards.' });
  });

  it('returns 502 when every model fails, so the client uses its deterministic fallback', async () => {
    const f = vi.fn().mockResolvedValue(reply(503, {}));
    expect((await call(f as unknown as typeof fetch)).status).toBe(502);
  });
});
