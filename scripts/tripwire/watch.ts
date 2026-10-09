// Operator-side watcher: observes and scores, holds no key and sends nothing (ADR-012).
import type { Hex } from 'viem';
import { z } from 'zod';
import { scoreTransfer, DEFAULT_CONFIG, type ScreeningSource } from '../../src/tripwire/riskScorer.js';
import type { BridgeTransfer, ChainId, ContractRiskSummary, RiskAssessment, RouteBaseline } from '../../src/tripwire/types.js';
import { burnEventSchema, releaseEventSchema, type BurnEvent, type LogFeed, type ReleaseEvent } from './events.js';
import type { OperatorStore, WatcherState } from './store.js';
import { FinalityConflictError } from './finality.js';
import type { sourceVerifierScopeSchema } from './sourceProof.js';
import { CctpAuditFailure } from './auditFailure.js';
import { routePolicySchema, type RoutePolicy } from './settlement.js';
import type { BaselineSample } from './baseline.js';

/** Recomputes the route baseline each tick from finalized source burns (HIGH-2). */
export type BaselineProvider = (samples: readonly BaselineSample[], now: number) => Promise<RouteBaseline | null> | RouteBaseline | null;
/** Explorer lookups are read-only and slow: run this many at once, ahead of scoring. */
const LOOKUP_CONCURRENCY = 4;

export interface SourceAdapter {
  scope: z.infer<typeof sourceVerifierScopeSchema>;
  verify(release: ReleaseEvent): Promise<SourceEvidence>;
  assertCanonical(): Promise<void>;
}

export interface WatcherConfig {
  route: string;
  chain: ChainId;
  token: string;
  decimals: number;
  bridge: Hex;
  ingress: LogFeed<BurnEvent>;
  egress: LogFeed<ReleaseEvent>;
  /** A fixed baseline, a provider read on every tick, or null: without one every payout holds. */
  baseline: RouteBaseline | null | BaselineProvider;
  screening: ScreeningSource;
  contractFacts?: (address: Hex) => Promise<ContractRiskSummary | null>;
  now: () => number;
  /** An adapter must establish finality and completeness before declaring missing backing invalid. */
  verifySource?: (release: ReleaseEvent, observedBurn: bigint | null) => Promise<SourceEvidence>;
  /** Authenticated source adapters also guard previously accepted proof anchors. */
  sourceAdapter?: SourceAdapter;
  /** How far under its proven burn a payout may come (fees, rounding). Default 0: exact. Never over. */
  payoutToleranceBps?: bigint;
  /** Operator-only durable state. Both feeds must support checkpoint/restore. */
  store?: OperatorStore;
  /** Per-route limits that can only add holds (ADR-023). Attached to every observation. */
  policy?: RoutePolicy;
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
  /** The route's limits, so every decision and signed review reads the same policy. */
  policy?: RoutePolicy;
}

export class Watcher {
  private burns = new Map<Hex, BurnEvent>();
  private recent: BridgeTransfer[] = [];
  private history = new Map<Hex, ReleaseEvent>();
  private pending = new Map<Hex, ReleaseEvent>();
  private completed = new Set<Hex>();
  private conflictingBurns = new Set<Hex>();
  private conflictingReleases = new Set<Hex>();
  private lock: Promise<unknown> = Promise.resolve();
  private quarantine: string | null = null;
  /** Held work the operator asked to re-check later, by chain-clock second. In memory: a restart re-checks everything. */
  private snoozed = new Map<Hex, number>();

  get quarantineReason(): string | null { return this.quarantine; }

  /** Skip a pending release's (costly) re-verification for `seconds` of chain time; it stays pending and unpaid meanwhile. */
  snooze(messageId: Hex, seconds: number): void {
    if (this.pending.has(messageId) && seconds > 0) this.snoozed.set(messageId, this.cfg.now() + seconds); else this.snoozed.delete(messageId);
  }

  constructor(private cfg: WatcherConfig) {
    if (cfg.sourceAdapter && cfg.verifySource) throw new Error('Configure one source verifier.');
    if (cfg.policy) cfg.policy = routePolicySchema.parse(cfg.policy);
    if (cfg.sourceAdapter && !cfg.store) throw new Error('Authenticated source adapter requires a durable store.');
    if (cfg.store) {
      if (!cfg.ingress.checkpoint || !cfg.ingress.restore || !cfg.egress.checkpoint || !cfg.egress.restore) {
        throw new Error('Durable watcher requires checkpointable feeds.');
      }
      const scope = cfg.store.scope;
      if (JSON.stringify(scope.sourceVerifier) !== JSON.stringify(cfg.sourceAdapter?.scope)) {
        throw new Error('Source adapter does not match the durable deployment scope.');
      }
      if (scope.finalityMode === 'finalized' && (!cfg.ingress.assertCanonical || !cfg.egress.assertCanonical)) {
        throw new Error('Finalized watcher requires canonical anchor checks on both feeds.');
      }
      if (scope.route !== cfg.route || scope.vault !== cfg.bridge.toLowerCase() || scope.decimals !== cfg.decimals) {
        throw new Error('Watcher deployment scope does not match its store.');
      }
      const state = cfg.store.loadWatcher();
      if (state) this.restore(state);
      this.quarantine = cfg.store.sourceQuarantine() ?? this.quarantine;
    }
  }

  tick(): Promise<Observation[]> {
    const run = this.lock.then(() => this.poll(), () => this.poll());
    this.lock = run.catch(() => undefined);
    return run;
  }

  assertCanonical(): Promise<void> {
    const run = this.lock.then(async () => {
      if (this.quarantine) throw new FinalityConflictError(`Operator is quarantined: ${this.quarantine}`);
      try { await this.cfg.ingress.assertCanonical?.(); await this.cfg.egress.assertCanonical?.(); await this.cfg.sourceAdapter?.assertCanonical(); }
      catch (error) { if (error instanceof FinalityConflictError) this.enterQuarantine(error); throw error; }
    });
    this.lock = run.catch(() => undefined); return run;
  }

  quarantineFinality(error: FinalityConflictError): Promise<void> {
    const run = this.lock.then(() => this.enterQuarantine(error));
    this.lock = run.catch(() => undefined); return run;
  }

  private enterQuarantine(error: FinalityConflictError): void {
    this.quarantine = error.message.slice(0, 2048);
    this.burns.clear(); this.conflictingBurns.clear(); this.recent = []; this.history.clear();
    this.persist();
  }

  /** Acknowledge only a confirmed execution or terminal rejection; HOLD/delay stay pending. */
  acknowledge(messageId: Hex, outcome?: 'executed' | 'rejected' | 'returned'): Promise<void> {
    const run = this.lock.then(() => {
      if (this.quarantine) throw new FinalityConflictError('Cannot acknowledge work while the operator is quarantined.');
      const previous = this.snapshot();
      const release = this.pending.get(messageId);
      if (outcome && release) this.cfg.store?.saveOutcome({ messageId, action: outcome, recipient: release.recipient, amount: release.amount });
      this.pending.delete(messageId);
      this.snoozed.delete(messageId);
      this.completed.add(messageId);
      try { this.persist(); } catch (error) { this.restore(previous); throw error; }
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async poll(): Promise<Observation[]> {
    const before = this.snapshot();
    if (!this.quarantine) {
      try {
        await this.cfg.sourceAdapter?.assertCanonical();
        for (const raw of await this.cfg.ingress.poll()) {
          const burn = burnEventSchema.parse(raw);
          const previous = this.burns.get(burn.messageId);
          if (previous !== undefined && previous.amount !== burn.amount) this.conflictingBurns.add(burn.messageId);
          // One message has one source amount. Replayed notifications cannot multiply its backing.
          this.burns.set(burn.messageId, burn);
        }
        for (const raw of await this.cfg.egress.poll()) {
          const release = releaseEventSchema.parse(raw);
          const previous = this.pending.get(release.messageId);
          if (previous && (previous.amount !== release.amount || previous.recipient !== release.recipient)) this.conflictingReleases.add(release.messageId);
          if (this.completed.has(release.messageId) || this.pending.has(release.messageId)) continue;
          this.pending.set(release.messageId, release);
        }
        this.persist();
      } catch (error) {
        this.restore(before);
        if (error instanceof FinalityConflictError) this.enterQuarantine(error); else throw error;
      }
    }

    const now = this.cfg.now();
    const releases = [...this.pending.values()].filter((r) => this.quarantine || !((this.snoozed.get(r.messageId) ?? 0) > now));
    const baseline = await this.baselineNow(now);
    const facts = await this.lookupRecipients(releases);
    const out: Observation[] = [];
    for (const release of releases) {
      const observedBurn = this.burns.get(release.messageId)?.amount ?? null;
      let source: SourceEvidence;
      try {
        source = sourceEvidenceSchema.parse(this.quarantine
          ? { status: 'unavailable', reason: `Finality quarantine: ${this.quarantine}`.slice(0, 1024) }
          : this.conflictingBurns.has(release.messageId) || this.conflictingReleases.has(release.messageId)
          ? { status: 'unavailable', reason: 'Observed message fields conflict; independent reconciliation is required.' }
          : this.cfg.sourceAdapter ? await this.cfg.sourceAdapter.verify(release)
          : this.cfg.verifySource
            ? await this.cfg.verifySource(release, observedBurn)
            : { status: 'pending', reason: 'Independent source verification is not configured; observed events alone are insufficient.' });
      } catch (error) {
        if (error instanceof CctpAuditFailure && error.reason === 'journal') throw error;
        if (error instanceof FinalityConflictError) this.enterQuarantine(error);
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
          burned, claimed: release.amount, toleranceBps: this.cfg.payoutToleranceBps ?? 0n,
        },
      };
      const lookup = this.quarantine ? undefined : facts.get(release.messageId);
      const lookupUnavailable = lookup === 'unavailable';
      const targetContract = lookup === 'unavailable' ? undefined : lookup ?? undefined;
      let assessment = scoreTransfer({
        transfer, baseline, recent: this.recent,
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
      if (!this.quarantine && !this.recent.some((t) => t.hash === transfer.hash)) this.remember(transfer, release);
      out.push({ release, burned, source, assessment, ...(this.cfg.policy ? { policy: this.cfg.policy } : {}) });
    }
    this.persist();
    return this.quarantine ? out.map((observation) => ({ ...observation, burned: null,
      source: { status: 'unavailable' as const, reason: `Finality quarantine: ${this.quarantine}`.slice(0, 1024) },
      assessment: { ...observation.assessment, verdict: 'indeterminate' as const, score: null, degradedReason: 'Finality quarantine; reconcile the operator.' },
    })) : out;
  }

  /** The route's baseline for this tick. A provider that fails yields none, so payouts hold. */
  private async baselineNow(now: number): Promise<RouteBaseline | null> {
    const configured = this.cfg.baseline;
    if (typeof configured !== 'function') return configured;
    if (this.quarantine) return null;
    const samples = [...this.burns.values()].filter((b) => !this.conflictingBurns.has(b.messageId))
      .map((b) => ({ amount: b.amount, timestamp: b.timestamp }));
    try { return await configured(samples, now); } catch { return null; }
  }

  /** Recipient facts for every release, a few lookups at a time. A failed lookup is recorded, not thrown. */
  private async lookupRecipients(releases: ReleaseEvent[]): Promise<Map<Hex, ContractRiskSummary | null | 'unavailable'>> {
    const facts = new Map<Hex, ContractRiskSummary | null | 'unavailable'>();
    const lookup = this.cfg.contractFacts;
    if (!lookup || this.quarantine) return facts;
    let next = 0;
    const worker = async () => {
      while (next < releases.length) {
        const release = releases[next++];
        try { facts.set(release.messageId, (await lookup(release.recipient)) ?? null); }
        catch { facts.set(release.messageId, 'unavailable'); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, releases.length) }, worker));
    return facts;
  }

  private snapshot(): WatcherState {
    return {
      ingressCursor: this.cfg.ingress.checkpoint?.() ?? '0', egressCursor: this.cfg.egress.checkpoint?.() ?? '0',
      burns: [...this.burns.values()], pending: [...this.pending.values()], completed: [...this.completed],
      conflictingBurns: [...this.conflictingBurns], conflictingReleases: [...this.conflictingReleases],
      history: [...this.history.values()],
      quarantine: this.quarantine ?? undefined,
    };
  }

  private restore(state: WatcherState): void {
    this.quarantine = state.quarantine ?? null;
    this.cfg.ingress.restore?.(state.ingressCursor); this.cfg.egress.restore?.(state.egressCursor);
    this.burns = new Map(state.burns.map((b) => [b.messageId, b]));
    this.pending = new Map(state.pending.map((r) => [r.messageId, r]));
    for (const id of this.snoozed.keys()) if (!this.pending.has(id)) this.snoozed.delete(id);
    this.completed = new Set(state.completed as Hex[]);
    this.conflictingBurns = new Set(state.conflictingBurns as Hex[]);
    this.conflictingReleases = new Set(state.conflictingReleases as Hex[]);
    this.history = new Map(state.history.map((r) => [r.messageId, r]));
    this.recent = state.history.map((r) => ({ hash: r.messageId, chain: this.cfg.chain, route: this.cfg.route,
      token: this.cfg.token, amountUsd: Number(r.amount) / 10 ** this.cfg.decimals, timestamp: r.timestamp,
      from: this.cfg.bridge, to: r.recipient }));
  }

  private persist(): void { this.cfg.store?.saveWatcher(this.snapshot()); }

  private remember(transfer: BridgeTransfer, release: ReleaseEvent) {
    this.recent.push(transfer);
    this.history.set(release.messageId, release);
    const since = this.cfg.now() - DEFAULT_CONFIG.velocityWindowSeconds;
    this.recent = this.recent.filter((t) => t.timestamp >= since);
    for (const [id, r] of this.history) if (r.timestamp < since) this.history.delete(id);
  }
}
