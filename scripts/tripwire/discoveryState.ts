// Operator-only discovery hints. This journal never authenticates backing.
import { z } from 'zod';
import { eventOriginSchema } from './events.js';
import { blockHashSchema, finalizedCheckpointSchema } from './finality.js';

const uint = z.union([z.bigint(), z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).transform(BigInt)])
  .pipe(z.bigint().nonnegative().max((1n << 256n) - 1n));
const nonzeroHash = blockHashSchema.refine((v) => !/^0x0{64}$/.test(v));
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase() as `0x${string}`);
const origin = eventOriginSchema.extend({ blockNumber: uint, logIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export const sourceHintSchema = z.object({ operationId: nonzeroHash, policyHash: nonzeroHash, returnRecipient: address, origin }).strict();
export const destinationHintSchema = z.object({ operationId: nonzeroHash, messageId: nonzeroHash, intentPolicyHash: nonzeroHash, returnRecipient: address, origin }).strict();
const header = z.object({ number: uint, hash: blockHashSchema, parentHash: blockHashSchema,
  timestamp: uint.refine((v) => v <= BigInt(Number.MAX_SAFE_INTEGER)) }).strict();
const range = z.object({ from: uint, through: header, checkpoint: z.string().max(4096) }).strict().superRefine((r, ctx) => {
  let c: z.infer<typeof finalizedCheckpointSchema>;
  try { c = finalizedCheckpointSchema.parse(JSON.parse(r.checkpoint)); }
  catch { ctx.addIssue({ code: 'custom', message: 'Invalid discovery checkpoint.' }); return; }
  if (BigInt(c.from) !== r.from || r.from > r.through.number || BigInt(c.next) !== r.through.number + 1n ||
    c.anchor?.number !== r.through.number.toString() || c.anchor.hash !== r.through.hash) ctx.addIssue({ code: 'custom', message: 'Discovery coverage differs from checkpoint.' });
});
export const discoveryStateSchema = z.object({ version: z.literal(1), fingerprint: nonzeroHash,
  source: range, destination: range, burns: z.array(sourceHintSchema).max(100), credits: z.array(destinationHintSchema).max(100),
}).strict().superRefine((s, ctx) => {
  for (const [rows, r] of [[s.burns, s.source], [s.credits, s.destination]] as const) {
    let c: z.infer<typeof finalizedCheckpointSchema>;
    try { c = finalizedCheckpointSchema.parse(JSON.parse(r.checkpoint)); }
    catch { continue; } // The range refinement has already reported this issue.
    const positions = new Set<string>(), hashes = new Map<bigint, string>(), transactions = new Map<string, bigint>();
    for (const row of rows) {
      const o = row.origin, key = `${o.blockNumber}/${o.logIndex}`;
      if (o.chainId !== c.chainId || o.address !== c.address || o.blockNumber < r.from || o.blockNumber > r.through.number ||
        (o.blockNumber === r.through.number && o.blockHash !== r.through.hash) || positions.has(key) ||
        (hashes.has(o.blockNumber) && hashes.get(o.blockNumber) !== o.blockHash) ||
        (transactions.has(o.transactionHash) && transactions.get(o.transactionHash) !== o.blockNumber)) ctx.addIssue({ code: 'custom', message: 'Discovery hint provenance differs from coverage.' });
      positions.add(key); hashes.set(o.blockNumber, o.blockHash); transactions.set(o.transactionHash, o.blockNumber);
    }
  }
});
export type DiscoveryState = z.output<typeof discoveryStateSchema>;
export type SourceHint = z.output<typeof sourceHintSchema>;
export type DestinationHint = z.output<typeof destinationHintSchema>;
