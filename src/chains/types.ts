import type { ChainId, Address, NormalizedTx } from '../domain';

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface AddressMatch {
  input: string;
  family: 'evm' | 'svm';
  format: 'hex' | 'base58' | 'ens' | 'sns';
}

export interface ResolvedAddress {
  address: Address;
  name?: string;
  chain: ChainId;
}

export interface AdapterCtx {
  signal?: AbortSignal;
  apiKey?: string;
  rpcUrl?: string;
}

export interface NormalizeCtx {
  chainId: ChainId;
  subject: Address;
}

export interface HistoryQuery {
  address: Address;
  chainId: ChainId;
  cursor?: string;
  limit?: number;
}

export interface HistoryPage<TRaw = any> {
  transactions: TRaw[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface PermissionFinding {
  id: string;
  asset: string;
  spenderOrDelegate: string;
  allowanceOrAmount: string;
  isUnlimited: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details?: string;
}

export interface ContractRiskReport {
  target: Address;
  isContract: boolean;
  isProxy?: boolean;
  upgradeAuthority?: Address | null;
  adminKeys?: Address[];
  riskLevel: 'low' | 'medium' | 'high';
  flags: string[];
  explanations: string[];
}

export interface ChainAdapter<TRaw = any> {
  readonly family: 'evm' | 'svm';
  readonly chains: ChainId[];

  canHandle(input: string): AddressMatch | null;
  resolve?(input: string, ctx?: AdapterCtx): Promise<Result<ResolvedAddress>>;

  fetchHistory(q: HistoryQuery, ctx?: AdapterCtx): AsyncIterable<Result<HistoryPage<TRaw>>>;
  normalize(raw: TRaw, subject: Address, ctx: NormalizeCtx): NormalizedTx;

  auditPermissions(subject: Address, ctx?: AdapterCtx): Promise<Result<PermissionFinding[]>>;
  scanContract(target: Address, ctx?: AdapterCtx): Promise<Result<ContractRiskReport>>;
}
