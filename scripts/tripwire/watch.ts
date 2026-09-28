// scripts/tripwire/watch.ts
//
// The watcher: pairs each pending release with the burn behind it, looks up
// what it is paying, and scores it before it executes. Read-only: it holds no
// key and sends nothing (ADR-012). The attestor acts on what it returns.

import type { Hex } from 'viem';
import { scoreTransfer, DEFAULT_CONFIG, type ScreeningSource } from '../../src/tripwire/riskScorer.js';
import type {
  BridgeTransfer,
  ChainId,
  ContractRiskSummary,
  RiskAssessment,
  RouteBaseline,
} from '../../src/tripwire/types.js';
import type { BurnEvent, LogFeed, ReleaseEvent } from './events.js';

export interface WatcherConfig {
  /** Human-readable route, e.g. "sepolia:base-sepolia:USDC". */
  route: string;
  chain: ChainId;
  token: string;
  decimals: number;
  /** The bridge's payout contract: the `from` of every release. */
  bridge: Hex;
  ingress: LogFeed<BurnEvent>;
  egress: LogFeed<ReleaseEvent>;
  baseline: RouteBaseline | null;
  screening: ScreeningSource;
  /** Retold's facts about the recipient, when it is a contract; null for a wallet or unknown. */
  contractFacts?: (address: Hex) => Promise<ContractRiskSummary | null>;
  /** Seconds since epoch. */
  now: () => number;
}

export interface Observation {
  release: ReleaseEvent;
  /** What the burn on the source chain proves, in token base units. 0 when no burn was seen. */
  burned: bigint;
  assessment: RiskAssessment;
}

export class Watcher {
  private burns = new Map<Hex, bigint>();
  private recent: BridgeTransfer[] = [];

  constructor(private cfg: WatcherConfig) {}

  /** Poll both chains once and score every new release. Ingress first, so a burn and its release in the same tick pair up. */
  async tick(): Promise<Observation[]> {
    for (const burn of await this.cfg.ingress.poll()) {
      this.burns.set(burn.messageId, (this.burns.get(burn.messageId) ?? 0n) + burn.amount);
    }

    const out: Observation[] = [];
    for (const release of await this.cfg.egress.poll()) {
      const burned = this.burns.get(release.messageId) ?? 0n;
      // The route carries a $1 stablecoin, so base units convert straight to
      // the scorer's USD. A volatile asset would be priced here instead.
      const usd = (units: bigint) => Number(units) / 10 ** this.cfg.decimals;
      const transfer: BridgeTransfer = {
        hash: release.messageId,
        chain: this.cfg.chain,
        route: this.cfg.route,
        token: this.cfg.token,
        amountUsd: usd(release.amount),
        timestamp: release.timestamp,
        from: this.cfg.bridge,
        to: release.recipient,
        claimedPayoutUsd: usd(release.amount),
        // Zero, not null: the watcher looked for the burn and found none.
        provenBurnUsd: usd(burned),
      };
      const targetContract = (await this.cfg.contractFacts?.(release.recipient)) ?? undefined;
      const assessment = scoreTransfer({
        transfer,
        baseline: this.cfg.baseline,
        recent: this.recent,
        screening: this.cfg.screening,
        now: this.cfg.now(),
        targetContract,
      });
      this.remember(transfer);
      out.push({ release, burned, assessment });
    }
    return out;
  }

  /**
   * Keep only what the velocity rule can still see. Requested releases, paid or
   * blocked: an attempted drain is pressure on the route either way.
   */
  private remember(transfer: BridgeTransfer) {
    this.recent.push(transfer);
    const since = this.cfg.now() - DEFAULT_CONFIG.velocityWindowSeconds;
    this.recent = this.recent.filter((t) => t.timestamp >= since);
  }
}
