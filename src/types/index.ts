// src/types/index.ts

export type TaxCategory = 'trade' | 'income' | 'transfer' | 'nft' | 'unknown';
export type ClassificationStatus = 'pending' | 'classifying' | 'classified' | 'error';

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
}

export interface ClassifiedTransaction extends RawTransaction {
  description: string;
  category: TaxCategory;
  confidence: number;
  usdValue: number | null;
  ethValue: number;
  status: ClassificationStatus;
  date: Date;
}

export interface TaxSummary {
  tradeTotal: number;
  incomeTotal: number;
  transferCount: number;
  nftCount: number;
  unknownCount: number;
  totalTransactions: number;
  totalGasSpent: number;
}

export interface FilterOption {
  label: string;
  value: TaxCategory | 'all';
  count: number;
}
