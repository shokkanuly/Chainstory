// Operator-side watcher: observes and scores, holds no key and sends nothing (ADR-012).
import type { Hex } from 'viem';
import { z } from 'zod';
import { scoreTransfer, DEFAULT_CONFIG, type ScreeningSource } from '../../src/tripwire/riskScorer.js';
import type { BridgeTransfer, ChainId, ContractRiskSummary, RiskAssessment, RouteBaseline } from '../../src/tripwire/types.js';
import type { BurnEvent, LogFeed, ReleaseEvent } from './events.js';

export interface WatcherConfig {
  route: string;
  chain: ChainId;
  token: string;
  decimals: number;
  bridge: Hex;
  ingress: LogFeed<BurnEvent>;
  egress: LogFeed<ReleaseEvent>;
  baseline: RouteBaseline | null;
  screening: ScreeningSource;
  contractFacts?: (address: Hex) => Promise<ContractRiskSummary | null>;
  now: () => number;
  /** An adapter must establish finality and completeness before declaring missing backing invalid. */
  verifySource?: (release: ReleaseEvent, observedBurn: bigint | null) => Promise<SourceEvidence>;
  /** Exact same-asset fee/rounding tolerance. Demo default mirrors the old 1% rule. */
  payoutToleranceBps?: bigint;
}

const sourceEvidenceSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('verified'), amount: z.bigint().positive() }),
  z.object({ status: z.literal('pending'), reason: z.string().min(1).max(1024) }),
  z.object({ status: z.literal('unavailable'), reason: z.string().min(1).max(1024) }),
  z.object({ status: z.literal('invalid'), reason: z.string().min(1).max(1024) }),
]);
export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;

export interface Observation {
  release: ReleaseEvent;
  /** Null means missing data; zero is reserved for a source check that established invalid backing. */
  burned: bigint | null;
  source: SourceEvidence;
  assessment: RiskAssessment;
}

export class Watcher {
  private burns = new Map<Hex, bigint>();
  private recent: BridgeTransfer[] = [];
  private pending = new Map<Hex, ReleaseEvent>();
  private completed = new Set<Hex>();
  private conflictingBurns = new Set<Hex>();
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private cfg: WatcherConfig) {}

  tick(): Promise<Observation[]> {
    const run = this.lock.then(() => this.poll(), () => this.poll());
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Acknowledge only after the operator records the review's confirmed on-chain outcome. */
  acknowledge(messageId: Hex): void {
    this.pending.delete(messageId);
    this.completed.add(messageId);
  }

  private async poll(): Promise<Observation[]> {
    for (const burn of await this.cfg.ingress.poll()) {
      const previous = this.burns.get(burn.messageId);
      if (previous !== undefined && previous !== burn.amount) this.conflictingBurns.add(burn.messageId);
      // One message has one source amount. Replayed notifications cannot multiply its backing.
      this.burns.set(burn.messageId, burn.amount);
    }
    for (const release of await this.cfg.egress.poll()) {
      if (this.completed.has(release.messageId) || this.pending.has(release.messageId)) continue;
      this.pending.set(release.messageId, release);
    }

    const out: Observation[] = [];
    for (const release of this.pending.values()) {
      const observedBurn = this.burns.get(release.messageId) ?? null;
      let source: SourceEvidence;
      try {
        source = sourceEvidenceSchema.parse(this.conflictingBurns.has(release.messageId)
          ? { status: 'unavailable', reason: 'Observed source amounts conflict; independent reconciliation is required.' }
          : this.cfg.verifySource
            ? await this.cfg.verifySource(release, observedBurn)
            : { status: 'pending', reason: 'Independent source verification is not configured; observed events alone are insufficient.' });
      } catch {
        source = { status: 'unavailable', reason: 'Source verification is unavailable; retry required.' };
      }
      const burned = source.status === 'verified' ? source.amount : source.status === 'invalid' ? 0n : null;
      // Approximate USD values feed behavioral heuristics for this $1 demo token only.
      // Security-critical backing comparisons below use bigint token base units.
      const usd = (units: bigint) => Number(units) / 10 ** this.cfg.decimals;
      const transfer: BridgeTransfer = {
        hash: release.messageId, chain: this.cfg.chain, route: this.cfg.route, token: this.cfg.token,
        amountUsd: usd(release.amount), timestamp: release.timestamp, from: this.cfg.bridge, to: release.recipient,
        claimedPayoutUsd: usd(release.amount), provenBurnUsd: burned === null ? null : usd(burned),
        backing: burned === null ? undefined : {
          burned, claimed: release.amount, toleranceBps: this.cfg.payoutToleranceBps ?? 100n,
        },
      };
      let lookupUnavailable = false;
      let targetContract: ContractRiskSummary | undefined;
      try {
        targetContract = (await this.cfg.contractFacts?.(release.recipient)) ?? undefined;
      } catch {
        lookupUnavailable = true;
      }
      let assessment = scoreTransfer({
        transfer, baseline: this.cfg.baseline, recent: this.recent,
        screening: this.cfg.screening, now: this.cfg.now(), targetContract,
      });
      // A recipient lookup failure cannot hide a proven mismatch. Missing source
      // evidence, however, can never become permission to pay out.
      if (burned === null || (lookupUnavailable && assessment.score !== 1)) {
        assessment = {
          ...assessment, verdict: 'indeterminate', score: null,
          degradedReason: burned === null && source.status !== 'verified'
            ? source.reason : 'Recipient lookup unavailable; retry required.',
        };
      }
      if (!this.recent.some((t) => t.hash === transfer.hash)) this.remember(transfer);
      out.push({ release, burned, source, assessment });
    }
    return out;
  }

  private remember(transfer: BridgeTransfer) {
    this.recent.push(transfer);
    const since = this.cfg.now() - DEFAULT_CONFIG.velocityWindowSeconds;
    this.recent = this.recent.filter((t) => t.timestamp >= since);
  }
}
