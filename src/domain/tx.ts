import { z } from 'zod';
import { ChainIdSchema } from './chain';
import { AddressSchema, AssetSchema } from './asset';
import { MovementSchema } from './movement';

export const InteractionSchema = z.object({
  target: AddressSchema,
  protocol: z.string().optional(),
  method: z.string().optional(),
  index: z.number().int().optional(),
  decoded: z.boolean(),
});
export type Interaction = z.infer<typeof InteractionSchema>;

export const TagSchema = z.enum([
  'compressed_state',
  'compression:compress',
  'compression:decompress',
  'compression:transfer',
  'jito_tip',
  'priority_fee',
  'unknown_program',
  'failed',
  'approval',
  'unlimited_approval',
  'authority_change',
  'delegate_set',
  'flagged_counterparty',
]);
export type Tag = z.infer<typeof TagSchema>;

export const NormalizedTxSchema = z.object({
  id: z.string().min(1),
  chain: ChainIdSchema,
  hash: z.string().min(1),
  time: z.number().int(),
  position: z.object({
    block: z.number().int().optional(),
    slot: z.number().int().optional(),
    index: z.number().int().optional(),
  }),
  status: z.enum(['success', 'failed']),
  subject: AddressSchema,
  feePayer: AddressSchema,
  fee: z.object({
    asset: AssetSchema,
    amount: z.bigint(),
    parts: z.object({
      base: z.bigint(),
      priority: z.bigint().optional(),
      tip: z.bigint().optional(),
    }).optional(),
  }),
  movements: z.array(MovementSchema),
  interactions: z.array(InteractionSchema),
  tags: z.array(TagSchema),
  provenance: z.object({
    adapter: z.string(),
    adapterVersion: z.string(),
    rawRef: z.string(),
  }),
});
export type NormalizedTx = z.infer<typeof NormalizedTxSchema>;
