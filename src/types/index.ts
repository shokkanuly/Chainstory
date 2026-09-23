// src/types/index.ts

export type TaxCategory = 'trade' | 'income' | 'transfer' | 'nft' | 'unknown';
export type ClassificationStatus = 'pending' | 'classifying' | 'classified' | 'error';
export type TimelineViewMode = 'classified' | 'raw';
export type ChainId = 'ethereum' | 'arbitrum' | 'base' | 'optimism' | 'polygon';

/**
 * Where a batch of transactions came from. 'demo' means synthetic data
 * generated locally because no API key was configured or the explorer
 * request failed — it must never be presented as real chain history.
 */
export type DataSource = 'live' | 'demo';

export interface FetchResult {
  transactions: RawTransaction[];
  source: DataSource;
  /** Why we fell back to demo data, if we did. */
  demoReason?: string;
}

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
  /**
   * True when this record came from the explorer's `tokentx` endpoint, which
   * means `value` is denominated in the token's own decimals — NOT in wei.
   * Asset resolution depends on this; see services/assetResolver.ts.
   */
  isTokenTransfer?: boolean;
  /** True when this record was synthesised locally rather than fetched. */
  isDemo?: boolean;
}

export interface ClassifiedTransaction extends RawTransaction {
  description: string;
  category: TaxCategory;
  confidence: number;
  usdValue: number | null;
  ethValue: number;
  status: ClassificationStatus;
  date: Date;
  /** The asset actually moved by this transaction (e.g. 'ETH', 'USDC'). */
  assetSymbol: string;
  /** How much of `assetSymbol` moved, in whole units. */
  assetAmount: number;
  /** Native-token price in USD at this transaction's timestamp, for gas costing. */
  ethPriceUsd: number | null;
  /** One entry per tax lot consumed — a disposal can span several lots. */
  realizedGainLosses?: RealizedGainLoss[];
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
  missingPriceCount?: number;
  /** Disposals whose acquisition predates the fetch window. */
  unmatchedDisposalCount?: number;
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
  missingPriceCount: number;
  /**
   * Disposals with no matching acquisition lot — usually because the
   * acquisition predates the fetch window. Their cost basis is unknown, so
   * the reported gain for them is an upper bound, not a fact.
   */
  unmatchedDisposalCount: number;
  /** Quantity of asset disposed with no known cost basis, keyed by symbol. */
  unmatchedDisposalAmounts: Record<string, number>;
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
