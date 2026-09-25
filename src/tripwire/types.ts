// src/tripwire/types.ts
//
// The vocabulary of the risk oracle.
//
// One idea drives the shape of everything here: a circuit breaker that fails
// open is worse than no circuit breaker, because it is trusted. So every type
// that can be absent is absent explicitly — `null` rather than a default, and
// an `OracleHealth` record that travels with the assessment. Nothing in this
// module is allowed to turn "I could not tell" into "looks fine".

export type ChainId = 'ethereum' | 'arbitrum' | 'base' | 'optimism';

/** A single outflow from a protected bridge or vault. */
export interface BridgeTransfer {
  hash: string;
  chain: ChainId;
  /** Opaque route id — the (source, destination, asset) triple the guard pauses. */
  route: string;
  token: string;
  /** Outflow size in USD. Null when pricing is unavailable; never defaulted to 0. */
  amountUsd: number | null;
  /** Seconds since epoch. */
  timestamp: number;
  from: string;
  /** Recipient of the outflow — the address counterparty screening looks at. */
  to: string;
  /**
   * What the destination chain is about to pay out, and what the source-chain
   * burn actually proves. Verus lost $11.58M because these were never compared.
   * Both null on routes where the bridge does not expose a burn proof.
   */
  claimedPayoutUsd?: number | null;
  provenBurnUsd?: number | null;
}

/**
 * Rolling statistics for one route. Built from observed history, not configured
 * by hand — a static daily cap is exactly what this is meant to improve on.
 */
export interface RouteBaseline {
  route: string;
  /** How much history the numbers below summarise. */
  windowHours: number;
  /** Number of transfers observed in the window. Small samples are not trusted. */
  sampleSize: number;
  medianTransferUsd: number;
  p95TransferUsd: number;
  /** Total value locked behind the route, used for "share of the pool" checks. */
  rollingTvlUsd: number;
  /** When the baseline was last recomputed, seconds since epoch. */
  computedAt: number;
}

/** What the oracle could actually see when it scored. */
export interface OracleHealth {
  /** A baseline exists and is recent enough to compare against. */
  baselineFresh: boolean;
  /** The counterparty screening list loaded. */
  screeningAvailable: boolean;
  /** The transfer could be priced. */
  priceAvailable: boolean;
}

export type SignalId =
  | 'proof_payout_mismatch'
  | 'size_vs_baseline'
  | 'withdrawal_velocity'
  | 'counterparty_screen';

export interface RiskSignal {
  id: SignalId;
  /** 0 = nothing seen, 1 = as bad as this signal gets. */
  score: number;
  weight: number;
  /** Plain English, for the dashboard and the incident review. */
  reason: string;
  /**
   * Deterministic signals are proof of a broken invariant rather than an
   * estimate. They set the floor for the overall score and cannot be averaged
   * away by other signals looking calm.
   */
  deterministic?: boolean;
}

/**
 * `indeterminate` is a first-class verdict, not an error. It means the oracle
 * was unable to form an opinion, and the decision layer must treat it as "do
 * not vouch for this transfer" rather than as a low score.
 */
export type Verdict = 'clear' | 'elevated' | 'trip' | 'indeterminate';

export interface RiskAssessment {
  transfer: BridgeTransfer;
  /** 0..1. Null when the verdict is `indeterminate`. */
  score: number | null;
  verdict: Verdict;
  signals: RiskSignal[];
  health: OracleHealth;
  /** Why the oracle returned `indeterminate`, when it did. */
  degradedReason?: string;
}
