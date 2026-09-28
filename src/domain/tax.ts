import { z } from 'zod';
import { AssetSchema } from './asset';

export const TaxEventKindSchema = z.enum([
  'acquire',
  'dispose',
  'income',
  'fee',
  'nontaxable_move',
]);
export type TaxEventKind = z.infer<typeof TaxEventKindSchema>;

export const TaxEventSchema = z.object({
  txId: z.string(),
  kind: TaxEventKindSchema,
  asset: AssetSchema,
  amount: z.bigint(),
  usdValue: z.number().nullable(),
  time: z.number().int(),
  basisHint: z.enum(['purchase', 'reward', 'airdrop']).optional(),
});
export type TaxEvent = z.infer<typeof TaxEventSchema>;

export interface TaxLot {
  id: string;
  walletAddress: string;
  assetKey: string;
  assetSymbol: string;
  amount: bigint;
  remainingAmount: bigint;
  costBasisUsd: number;
  totalCostUsd: number;
  acquiredDate: Date;
  txHash: string;
}

export interface RealizedTaxGainLoss {
  txHash: string;
  assetSymbol: string;
  amountDisposed: bigint;
  proceedsUsd: number;
  costBasisUsd: number;
  gainLossUsd: number;
  holdingPeriod: 'short_term' | 'long_term';
  disposedDate: Date;
  gasDeductionUsd: number;
}
