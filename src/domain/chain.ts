import { z } from 'zod';

export const ChainFamilySchema = z.enum(['evm', 'svm']);
export type ChainFamily = z.infer<typeof ChainFamilySchema>;

// CAIP-2 Identifiers
export const ChainIdSchema = z.string().min(3);
export type ChainId = z.infer<typeof ChainIdSchema>;

export const WELL_KNOWN_CHAINS = {
  ETHEREUM: 'eip155:1',
  ARBITRUM: 'eip155:42161',
  BASE: 'eip155:8453',
  OPTIMISM: 'eip155:10',
  POLYGON: 'eip155:137',
  SOLANA_MAINNET: 'solana:mainnet',
  SOLANA_DEVNET: 'solana:devnet',
} as const;
