// scripts/tripwire/rpcQuorum.ts
//
// Independent verification across RPC providers (ADR-022). The source verifier
// reads chain state through one interface; this implements it over several
// independently operated endpoints, so no single provider is trusted.
//
// Rules, all fail-closed:
//   - At least `quorum` providers must answer, and every provider that answers
//     must agree on the canonical content. One dissent makes the read
//     unavailable (the release holds and is retried), never approved.
//   - The finalized head is the highest block that at least `quorum` providers
//     report as finalized, re-read by number with the same agreement rule.
//   - Providers disagreeing on a block that a quorum calls finalized is a
//     FinalityConflictError: the operator quarantines for human reconciliation.
//   - Provider failures and malformed answers count as no answer.
import { z } from 'zod';
import { blockHeaderSchema, FinalityConflictError } from './finality.js';
import type { CctpRpc } from './cctp.js';

export class RpcDisagreementError extends Error {
  constructor(message: string) { super(message); this.name = 'RpcDisagreementError'; }
}
export class RpcQuorumUnavailableError extends Error {
  constructor(readonly answered: number, readonly quorum: number, readonly method: string) {
    super(`${method}: ${answered} of ${quorum} required independent RPC answers.`);
    this.name = 'RpcQuorumUnavailableError';
  }
}

export interface RpcQuorumOptions {
  /** Minimum independent providers that must answer. At least 2 when 2 or more providers are configured. */
  quorum: number;
}

const json = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/).transform((v) => v.toLowerCase());
// Only fields a source proof depends on are compared; providers legitimately
// differ on presentation-only fields (gas price formatting, extra keys).
const receiptKeySchema = z.object({
  transactionHash: hex, blockNumber: z.bigint(), blockHash: hex, status: z.string(),
  logs: z.array(z.object({
    address: hex, blockNumber: z.bigint(), blockHash: hex, transactionHash: hex,
    logIndex: z.number(), removed: z.boolean(), topics: z.array(hex), data: hex,
  })),
});
const headerKey = (raw: unknown) => {
  const h = blockHeaderSchema.parse(raw);
  return json([h.number, h.hash, h.parentHash, h.timestamp]);
};

interface Answer<T> { value: T; key: string; provider: number }

export function rpcQuorum(providers: CctpRpc[], opts: RpcQuorumOptions): CctpRpc {
  const n = providers.length;
  if (n === 0) throw new Error('RPC quorum requires at least one provider.');
  const quorum = z.number().int().min(Math.min(n, 2)).max(n).parse(opts.quorum);

  async function gather<T>(method: string, call: (p: CctpRpc) => Promise<T>, key: (value: T) => string,
    among: number[] = providers.map((_, i) => i)): Promise<Answer<T>[]> {
    const settled = await Promise.allSettled(among.map(async (provider) => {
      const value = await call(providers[provider]);
      return { value, key: key(value), provider };
    }));
    const answers = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    if (answers.length < quorum) throw new RpcQuorumUnavailableError(answers.length, quorum, method);
    return answers;
  }

  async function agreed<T>(method: string, call: (p: CctpRpc) => Promise<T>, key: (value: T) => string,
    opts: { among?: number[]; dissent?: (message: string) => Error } = {}): Promise<T> {
    const answers = await gather(method, call, key, opts.among);
    const first = answers[0];
    if (answers.some((a) => a.key !== first.key)) {
      throw (opts.dissent ?? ((m: string) => new RpcDisagreementError(m)))(`${method}: independent RPC providers disagree.`);
    }
    return first.value;
  }

  return {
    getChainId: () => agreed('getChainId', (p) => p.getChainId(), (v) => json(z.number().int().positive().parse(v))),

    getTransactionReceipt: (args) => agreed(`getTransactionReceipt(${args.hash})`, (p) => p.getTransactionReceipt(args),
      (v) => (v === null ? 'null' : json(receiptKeySchema.parse(v)))),

    async getBlock(args) {
      if (args.blockTag !== 'finalized') {
        return agreed(`getBlock(${args.blockNumber})`, (p) => p.getBlock({ blockNumber: args.blockNumber }), headerKey);
      }
      const heads = await gather('getBlock(finalized)', (p) => p.getBlock({ blockTag: 'finalized' }),
        (v) => json(blockHeaderSchema.parse(v).number));
      const height = (a: Answer<unknown>) => blockHeaderSchema.parse(a.value).number;
      const numbers = heads.map(height).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
      // The highest height at least `quorum` providers have finalized.
      const finalized = numbers[quorum - 1];
      // Only providers that vouched for that height being final are compared; a
      // disagreement between them is conflicting finalized history, not lag.
      const vouching = heads.filter((a) => height(a) >= finalized).map((a) => a.provider);
      return agreed(`getBlock(${finalized})`, (p) => p.getBlock({ blockNumber: finalized }), headerKey, {
        among: vouching,
        dissent: (m) => new FinalityConflictError(`${m} Conflicting finalized history at block ${finalized}.`),
      });
    },
  };
}
