import { z } from 'zod';
import { ChainIdSchema } from './chain';

export const AddressSchema = z.string().min(1);
export type Address = z.infer<typeof AddressSchema>;

export const AssetKindSchema = z.enum(['native', 'fungible', 'nft']);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetKeySchema = z.string().min(1);
export type AssetKey = z.infer<typeof AssetKeySchema>;

export const AssetSchema = z.object({
  key: AssetKeySchema,
  chain: ChainIdSchema,
  kind: AssetKindSchema,
  address: AddressSchema.optional(),
  symbol: z.string().max(32).optional(),
  decimals: z.number().int().min(0).max(36),
});
export type Asset = z.infer<typeof AssetSchema>;

export function createAssetKey(chain: string, kind: AssetKind, address?: string): AssetKey {
  if (kind === 'native') {
    return `${chain}/native`;
  }
  const prefix = chain.startsWith('solana') ? 'spl' : 'erc20';
  return `${chain}/${prefix}:${(address || 'unknown').toLowerCase()}`;
}
