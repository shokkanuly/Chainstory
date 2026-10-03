// Ethereum/Sepolia RPC finality boundaries, not a consensus light client (ADR-016).
import { z } from 'zod';
import type { Hex } from 'viem';

export const blockHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v.toLowerCase() as Hex);
export const blockHeaderSchema = z.object({
  number: z.bigint().nonnegative(), hash: blockHashSchema, parentHash: blockHashSchema,
  timestamp: z.bigint().nonnegative().max(BigInt(Number.MAX_SAFE_INTEGER)),
});
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const finalizedCheckpointSchema = z.object({
  // 'safe' is for destination release requests only (MED-2); source proofs stay 'finalized'.
  version: z.literal(1), policy: z.enum(['finalized', 'safe']), chainId: z.number().int().positive(),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((a) => a.toLowerCase()), event: z.string().min(1),
  from: decimal, next: decimal, anchor: z.object({ number: decimal, hash: blockHashSchema }).nullable(),
}).strict().refine((c) => BigInt(c.next) >= BigInt(c.from) &&
  (c.anchor ? BigInt(c.anchor.number) + 1n === BigInt(c.next) : c.next === c.from), 'Invalid checkpoint range.');
export const feedCheckpointSchema = z.string().min(1).max(4096).refine((s) => {
  if (/^(0|[1-9][0-9]*)$/.test(s)) return true; // Local/instant demo feed only.
  try { return finalizedCheckpointSchema.safeParse(JSON.parse(s)).success; } catch { return false; }
}, 'Invalid feed checkpoint.');
export class FinalityConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'FinalityConflictError'; }
}
export interface BlockReader {
  getBlock(args: { blockNumber: bigint; blockTag?: never } | { blockTag: 'finalized'; blockNumber?: never }): Promise<unknown>;
}
export interface ReceiptAnchor { blockNumber: bigint; blockHash?: Hex }
export type ReceiptFinality = 'pending' | 'finalized' | 'orphaned';

export async function receiptFinality(reader: BlockReader, receipt: ReceiptAnchor): Promise<ReceiptFinality> {
  const hash = blockHashSchema.parse(receipt.blockHash);
  const canonical = blockHeaderSchema.parse(await reader.getBlock({ blockNumber: receipt.blockNumber }));
  if (canonical.number !== receipt.blockNumber) throw new Error('RPC returned the wrong receipt block.');
  if (canonical.hash !== hash) return 'orphaned';
  const finalized = blockHeaderSchema.parse(await reader.getBlock({ blockTag: 'finalized' }));
  if (finalized.number < receipt.blockNumber) return 'pending';
  // Re-read the receipt's block after the finalized tag to catch an RPC switch.
  const checked = blockHeaderSchema.parse(await reader.getBlock({ blockNumber: receipt.blockNumber }));
  if (checked.number !== receipt.blockNumber || checked.hash !== hash) return 'orphaned';
  return 'finalized';
}
