// Display-only snapshots. No imported value can authorize execution.
export interface OperationsSnapshot {
  // Display continuity only; imported scope does not authenticate a publisher.
  observationScope?: string;
  kind: 'readiness' | 'payments' | 'unavailable'; capturedAt: string;
  routeLabel: string; provenance: 'imported'; synthetic: boolean; blockers: string[]; notes: string[];
  blocks: { label: string; number: bigint; hash: string; time: bigint }[];
  contracts: { label: string; address: string; predicted: boolean }[];
  accounts: { network: string; address: string; roles: string[]; balance: bigint; symbol: string; decimals: number }[];
  sourceTokenBalance?: { amount: bigint; symbol: string; decimals: number };
  packageHash?: string;
  observer?: { state: 'scheduled' | 'retrying' | 'stopped'; attempt: number; failures: number; nextCheckSeconds: number };
  payments: OperationsPayment[];
  discovery?: { ranges: { label: string; from: bigint; through: bigint }[]; sourceHints: number; destinationHints: number; paired: number;
    incremental?: { resumed: boolean; ranges: { label: string; from: bigint; through: bigint; remaining: bigint }[] };
    pendingSource: { operationId: string; transactionHash: string; explorerUrl: string }[];
    unmatchedDestination: { operationId: string; messageId: string; transactionHash: string; reason: string; explorerUrl: string }[]; conflicts: string[] };
}
export interface OperationsPayment {
  id: string; operationId?: string; recipient?: string; amount?: bigint; symbol: string; decimals: number;
  state: 'Pending' | 'Held' | 'Rejected' | 'Paid' | 'Return requested' | 'Returned' | 'Unavailable';
  evidence: 'verified' | 'pending' | 'invalid' | 'unavailable'; reasons: string[];
  policyVersion?: bigint; policyHash?: string; intentPolicyHash?: string; returnRecipient?: string; returnAt?: bigint;
  transactions: { label: string; hash: string; block: bigint; blockHash: string; explorerUrl: string }[];
  lifecycle?: { status: 'reported' | 'unavailable'; reason?: string;
    milestones: { label: string; time: bigint; hash: string; explorerUrl: string }[];
    settlementSeconds?: bigint; escrowSeconds?: bigint; closed: boolean; clockWarning: boolean };
}
export function formatDuration(seconds: bigint): string {
  if (seconds < 0n) throw new Error('Negative duration.');
  const days = seconds / 86400n, hours = seconds % 86400n / 3600n, minutes = seconds % 3600n / 60n;
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${seconds % 60n}s`].filter(Boolean).join(' ');
}
export function cleanDisplayText(value: string): string {
  return Array.from(value).filter((char) => {
    const code = char.charCodeAt(0);
    return (code >= 32 || code === 9 || code === 10 || code === 13) && code !== 127 &&
      !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069);
  }).join('');
}
export function snapshotAge(capturedAt: string, nowMs: number): 'recent' | 'stale' | 'future' {
  const age = nowMs - Date.parse(capturedAt);
  if (!Number.isFinite(age) || age < -120_000) return 'future';
  return age > 300_000 ? 'stale' : 'recent';
}
export function formatBaseUnits(amount: bigint, decimals: number): string {
  if (amount < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Invalid display amount.');
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals), fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${amount / scale}${fraction ? `.${fraction}` : ''}`;
}
