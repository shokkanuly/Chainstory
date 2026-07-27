// src/types/index.ts

export type TaxCategory = 'trade' | 'income' | 'transfer' | 'nft' | 'unknown';
export type ClassificationStatus = 'pending' | 'classifying' | 'classified' | 'error';
export type TimelineViewMode = 'classified' | 'raw';
export type ChainId = 'ethereum' | 'arbitrum' | 'base' | 'optimism' | 'polygon';

export interface ChainConfig {
  id: ChainId;
  name: string;
  symbol: string;
  icon: string;
  explorerUrl: string;
  apiUrl: string;
  color: string;
}

export interface RawTransaction {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string; // in wei
  gas: string;
  gasPrice: string;
  gasUsed: string;
  input: string;
  isError: string;
  txreceipt_status: string;
  functionName?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  contractAddress?: string;
  walletLabel?: string; // Originating wallet address label in multi-wallet mode
  chainId?: ChainId;
  isInternal?: boolean;
  decodedAbiMethod?: string;
}

export interface ClassifiedTransaction extends RawTransaction {
  description: string;
  category: TaxCategory;
  confidence: number;
  usdValue: number | null;
  ethValue: number;
  status: ClassificationStatus;
  date: Date;
  realizedGainLoss?: RealizedGainLoss | null;
}

export interface TaxSummary {
  tradeTotal: number;
  incomeTotal: number;
  transferCount: number;
  nftCount: number;
  unknownCount: number;
  totalTransactions: number;
  totalGasSpent: number;
  totalVolumeUsd: number;
  realizedGainTotal?: number;
  realizedLossTotal?: number;
  netTaxableIncome?: number;
  totalCostBasis?: number;
}

export interface FilterOption {
  label: string;
  value: TaxCategory | 'all';
  count: number;
}

export interface DemoWalletPreset {
  label: string;
  description: string;
  addresses: string[];
  chainId?: ChainId;
}

// -------------------------------------------------------------------
// FIFO Tax Accounting Engine Types (IRS Form 8949 / 1099-DA compliant)
// -------------------------------------------------------------------

export interface TaxLot {
  id: string;
  walletAddress: string;
  assetSymbol: string;
  amount: number;
  costBasisUsd: number; // Unit cost in USD at acquisition
  totalCostUsd: number; // Total lot cost basis
  acquiredDate: Date;
  txHash: string;
  remainingAmount: number;
}

export interface RealizedGainLoss {
  txHash: string;
  assetSymbol: string;
  amountDisposed: number;
  proceedsUsd: number;
  costBasisUsd: number;
  gainLossUsd: number;
  holdingPeriod: 'short_term' | 'long_term';
  disposedDate: Date;
  gasDeductionUsd: number;
}

export interface FifoAccountingReport {
  walletAddress: string;
  totalProceedsUsd: number;
  totalCostBasisUsd: number;
  totalRealizedGainUsd: number;
  totalRealizedLossUsd: number;
  totalGasExpenseUsd: number;
  netCapitalGainLossUsd: number;
  realizedTransactions: RealizedGainLoss[];
  remainingOpenLots: TaxLot[];
}

// -------------------------------------------------------------------
// B2B Pre-Sign Transaction Security & Simulation Types
// -------------------------------------------------------------------

export interface B2BSimulationPayload {
  from: string;
  to: string;
  value: string; // in wei or eth
  data: string;  // calldata hex
  chainId?: ChainId;
}

export interface B2BSimulationResult {
  severity: 'safe' | 'caution' | 'danger';
  headline: string;
  plainEnglishDescription: string;
  category: TaxCategory;
  decodedMethod: string;
  estimatedGasUsd: number;
  riskWarnings: string[];
  simulatedOutput: {
    expectedAssetOut?: string;
    expectedAssetIn?: string;
    targetProtocol?: string;
  };
}
