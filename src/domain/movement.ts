import { z } from 'zod';
import { AssetSchema, AddressSchema } from './asset';

export const MovementRoleSchema = z.enum([
  'transfer',
  'swap_leg',
  'fee',
  'rent',
  'reward',
  'mint',
  'burn',
  'wrap',
  'unwrap',
  'compress',
  'decompress',
]);
export type MovementRole = z.infer<typeof MovementRoleSchema>;

export const MovementStateSchema = z.enum(['standard', 'compressed']);
export type MovementState = z.infer<typeof MovementStateSchema>;

export const MovementDirectionSchema = z.enum(['in', 'out']);
export type MovementDirection = z.infer<typeof MovementDirectionSchema>;

export const MovementSchema = z.object({
  asset: AssetSchema,
  amount: z.bigint().refine((val) => val >= 0n, { message: 'Movement amount must be non-negative' }),
  direction: MovementDirectionSchema,
  counterparty: AddressSchema.optional(),
  state: MovementStateSchema,
  role: MovementRoleSchema,
});
export type Movement = z.infer<typeof MovementSchema>;
