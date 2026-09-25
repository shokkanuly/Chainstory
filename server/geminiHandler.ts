// server/geminiHandler.ts
//
// Server-side proxy for Gemini description generation.
//
// The important design choice: the client does NOT send a prompt. It sends
// structured transaction fields, and the prompt is assembled here. If the
// client could send free text, this endpoint would be an open LLM funded by
// our key, which is exactly the abuse a naive proxy invites.
//
// Everything here degrades to a 503 when no key is configured, and the client
// already has a deterministic keyword fallback that covers every transaction,
// so description generation never becomes a hard dependency.

import { rateLimit, type HandlerResponse } from './explorerHandler.js';

const GEMINI_ENDPOINTS = [
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
];

const CATEGORIES = ['trade', 'income', 'transfer', 'nft', 'unknown'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  trade: 'a crypto trade/swap (exchanging one asset for another)',
  income: 'crypto income (staking reward, airdrop, yield farming)',
  transfer: 'a simple transfer (moving assets between wallets, wrapping/unwrapping)',
  nft: 'an NFT operation (mint, purchase, sale, or transfer of a collectible)',
  unknown: 'a blockchain transaction',
};

/** Exactly the fields the prompt needs. Anything else is ignored. */
export interface DescribeRequest {
  from?: string;
  to?: string;
  category?: string;
  ethValue?: number;
  usdValue?: number | null;
  methodLabel?: string;
  functionName?: string;
  tokenName?: string;
  tokenSymbol?: string;
  isError?: boolean;
}

const MAX_FIELD = 120;

function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Strip newlines so a field cannot inject extra prompt instructions, and cap
  // length so the payload stays small.
  return value.replace(/[\r\n]+/g, ' ').slice(0, MAX_FIELD).trim();
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function buildPrompt(tx: DescribeRequest): string {
  const category = (CATEGORIES as readonly string[]).includes(tx.category ?? '')
    ? (tx.category as Category)
    : 'unknown';

  const ethValue = num(tx.ethValue);
  const usdText =
    typeof tx.usdValue === 'number' && Number.isFinite(tx.usdValue)
      ? `~$${tx.usdValue.toFixed(2)} USD`
      : 'unknown USD value';
  const token = clean(tx.tokenSymbol)
    ? ` involving ${clean(tx.tokenName)} (${clean(tx.tokenSymbol)})`
    : '';

  return `Write a one-sentence, plain English description (max 15 words) of this Ethereum transaction.

This transaction has been classified as: ${CATEGORY_LABELS[category]}.

Details:
- From: ${clean(tx.from)}
- To: ${clean(tx.to) || 'Contract creation'}
- ETH value: ${ethValue.toFixed(6)} ETH (${usdText})
- Method: ${clean(tx.methodLabel) || 'contract interaction'}${token}
- Function: ${clean(tx.functionName) || 'N/A'}
- Failed: ${tx.isError ? 'YES' : 'No'}

Output ONLY the description text, nothing else. Examples:
- "Swapped 2 ETH for 3,400 USDC on Uniswap"
- "Claimed 0.045 ETH staking rewards from Lido"
- "Minted Bored Ape NFT #42069 for 0.8 ETH"
- "Transferred 1.5 ETH to secondary wallet"`;
}

export async function handleGemini(
  method: string,
  body: unknown,
  env: Record<string, string | undefined>,
  clientIp: string,
  fetchImpl: typeof fetch = fetch
): Promise<HandlerResponse> {
  if (method !== 'POST') {
    return { status: 405, body: { error: 'Method not allowed' } };
  }
  if (!rateLimit(`gemini:${clientIp}`)) {
    return { status: 429, body: { error: 'Rate limit exceeded. Try again shortly.' } };
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.includes('your_')) {
    // Client falls back to its deterministic description engine.
    return { status: 503, body: { error: 'No Gemini key configured on the server' } };
  }

  if (typeof body !== 'object' || body === null) {
    return { status: 400, body: { error: 'Expected a transaction object' } };
  }

  const prompt = buildPrompt(body as DescribeRequest);

  for (const endpoint of GEMINI_ENDPOINTS) {
    try {
      const upstream = await fetchImpl(`${endpoint}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 100,
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                description: {
                  type: 'STRING',
                  description: 'One plain English sentence summary of max 15 words',
                },
              },
              required: ['description'],
            },
          },
        }),
      });

      if (!upstream.ok) continue;

      const data = (await upstream.json()) as any;
      const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

      let description = raw;
      try {
        const parsed = JSON.parse(raw);
        description = parsed.description || parsed.summary || raw;
      } catch {
        /* model returned bare text */
      }

      const cleaned = description
        .replace(/^["']|["']$/g, '')
        .replace(/```.*$/gm, '')
        .trim();

      if (cleaned) return { status: 200, body: { description: cleaned } };
    } catch {
      // Try the next endpoint.
    }
  }

  return { status: 502, body: { error: 'Description generation failed' } };
}
