import { z } from 'zod';
import type { Hex } from 'viem';
import { blockHeaderSchema } from '../finality.js';
import type { ReleaseStatus } from '../operator.js';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value.toLowerCase() as Hex);
export const releaseTuple = z.tuple([address, z.bigint().positive(), z.number().int().min(0).max(4),
  z.bigint().nonnegative(), address, z.bigint().nonnegative(), z.number().int().min(0).max(3)]);

/** Reconcile request and sticky delay with one chain clock before deciding to wait. */
export async function readReleasePolicyState(reader: {
  getBlock(args: { blockTag: 'latest' } | { blockNumber: bigint }): Promise<unknown>;
  readRelease(blockNumber: bigint): Promise<unknown>;
  readDelay(blockNumber: bigint): Promise<unknown>;
  minimumBlock(): bigint;
}): Promise<ReleaseStatus> {
  const head = blockHeaderSchema.parse(await reader.getBlock({ blockTag: 'latest' }));
  if (head.number < reader.minimumBlock()) throw new Error('Release RPC is behind an observed transaction.');
  const r = releaseTuple.parse(await reader.readRelease(head.number));
  const until = z.bigint().nonnegative().max((1n << 256n) - 1n).parse(await reader.readDelay(head.number));
  const checked = blockHeaderSchema.parse(await reader.getBlock({ blockNumber: head.number }));
  if (checked.number !== head.number || checked.hash !== head.hash || checked.timestamp !== head.timestamp) {
    throw new Error('Release state block changed while reading delay.');
  }
  return { recipient: r[0], amount: r[1], state: r[2], nonce: r[5], delay: { until, now: head.timestamp } };
}
