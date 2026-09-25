// src/tripwire/replay/engine.ts
//
// Replays an incident through the real oracle and the real guardian bytecode.
//
// Every event is scored once by the oracle, then released against two
// guardian deployments that differ only in when Tripwire acts:
//
//   pre   — scores the release before it executes, and lands its attestation
//           first. Needs the release to be visible in advance.
//   post  — reacts once the release is included, and lands its attestation a
//           block later. Needs nothing special, but cannot stop the release
//           that tripped it.
//
// Every exploit in these incidents drained in a single release, so the gap
// between the two is the whole story, and both are shown rather than the
// flattering one. Outcomes are real contract calls: a blocked release is a
// `RoutePaused` revert, and a refused attestation throws rather than being
// displayed as a pause that never happened.

import { keccak256, toHex, type Hex } from 'viem';
import artifact from '../guardian.artifact.js';
import { actors, GuardianVM, LOCAL_CHAIN_ID } from '../guardianVM.js';
import { signAttestation, toOnChainScore } from '../onChain.js';
import { scoreTransfer, type ScreeningSource } from '../riskScorer.js';
import type { BridgeTransfer, RiskAssessment } from '../types.js';
import { BLOCK_SECONDS, ILLUSTRATIVE_BASELINE, type Incident, type IncidentEvent } from './incidents.js';

export type Strategy = 'pre' | 'post';
export const STRATEGIES: Strategy[] = ['pre', 'post'];
export type Outcome = 'released' | 'blocked';
export type RouteStatus = 'ACTIVE' | 'RATE_LIMITED' | 'PAUSED';

export interface StepRecord {
  index: number;
  event: IncidentEvent;
  assessment: RiskAssessment;
  onChainScore: bigint;
  outcome: Record<Strategy, Outcome>;
}

export interface TripRecord {
  strategy: Strategy;
  /** The event whose assessment triggered the attestation. */
  triggerIndex: number;
  /** Replay seconds at which the attestation landed on-chain. */
  landedAt: number;
  riskScore: bigint;
  gas: bigint;
  /** Wall-clock milliseconds on this machine to score, sign and submit. */
  computeMs: number;
}

export interface Totals {
  lostUsd: number;
  heldLegitUsd: number;
  heldLegitCount: number;
}

export interface RouteView {
  key: string;
  chainLabel: string;
  routeLabel: string;
  status: RouteStatus;
  windowOutflowUsd: number;
  /** Replay seconds at which the pause lifts, if paused. */
  pausedUntil: number | null;
  incident: boolean;
}

export interface ReplaySnapshot {
  incident: Incident;
  steps: StepRecord[];
  /** Index of the next event to process. */
  cursor: number;
  done: boolean;
  /** Replay seconds of the last processed event. */
  clock: number;
  trips: Partial<Record<Strategy, TripRecord>>;
  totals: Record<Strategy, Totals>;
  /** What the incident actually cost, summed from the sourced events. */
  realityLostUsd: number;
  routes: Record<Strategy, RouteView[]>;
}

/** Rate cap off, so an outcome reflects the oracle alone. */
const CAP_DISABLED = 2n ** 127n;
const CAP_WINDOW = 24n * 3600n;
const STATUS: RouteStatus[] = ['ACTIVE', 'RATE_LIMITED', 'PAUSED'];

/** Fresh attacker addresses are on no list at the time of an exploit. */
const SCREENING: ScreeningSource = { isFlagged: () => false, describe: () => undefined };

const IDLE_ROUTES = [
  { chainLabel: 'Ethereum', routeLabel: 'USDC' },
  { chainLabel: 'Arbitrum', routeLabel: 'USDC' },
  { chainLabel: 'Base', routeLabel: 'WETH' },
  { chainLabel: 'Optimism', routeLabel: 'USDC' },
];

const routeId = (chainLabel: string, routeLabel: string): Hex => keccak256(toHex(`${chainLabel}:${routeLabel}`));

export class IncidentReplay {
  private cursor = 0;
  private clock = 0;
  private steps: StepRecord[] = [];
  private history: BridgeTransfer[] = [];
  private trips: Partial<Record<Strategy, TripRecord>> = {};
  private totals: Record<Strategy, Totals> = {
    pre: { lostUsd: 0, heldLegitUsd: 0, heldLegitCount: 0 },
    post: { lostUsd: 0, heldLegitUsd: 0, heldLegitCount: 0 },
  };
  private nonce: Record<Strategy, bigint> = { pre: 0n, post: 0n };
  private pendingPost: { landsAt: number; riskScore: bigint; triggerIndex: number; scoringMs: number } | null =
    null;
  private routes: Record<Strategy, RouteView[]> = { pre: [], post: [] };

  private constructor(
    readonly incident: Incident,
    private start: bigint,
    private guards: Record<Strategy, GuardianVM>,
    private route: Hex,
    private idle: { key: Hex; chainLabel: string; routeLabel: string }[]
  ) {}

  static async create(incident: Incident): Promise<IncidentReplay> {
    const start = BigInt(Math.floor(Date.parse(`${incident.date}T00:00:00Z`) / 1000));
    const route = routeId(incident.chainLabel, incident.routeLabel);
    const idle = IDLE_ROUTES.filter((r) => r.chainLabel !== incident.chainLabel)
      .slice(0, 3)
      .map((r) => ({ ...r, key: routeId(r.chainLabel, r.routeLabel) }));

    const guards = {} as Record<Strategy, GuardianVM>;
    for (const s of STRATEGIES) {
      const g = await GuardianVM.deploy(artifact, { start });
      for (const key of [route, ...idle.map((r) => r.key)]) {
        await expectOk(g.send(actors.owner, 'configureRoute', [key, CAP_DISABLED, CAP_WINDOW]), 'configureRoute');
      }
      await expectOk(g.send(actors.owner, 'setProtected', [actors.bridge.address, true]), 'setProtected');
      guards[s] = g;
    }

    const replay = new IncidentReplay(incident, start, guards, route, idle);
    await replay.refreshRoutes(true);
    return replay;
  }

  get done() {
    return this.cursor >= this.incident.events.length && this.pendingPost === null;
  }

  /** Process the next event. Returns null once the replay is complete. */
  async step(): Promise<StepRecord | null> {
    const events = this.incident.events;
    if (this.cursor >= events.length) {
      if (this.pendingPost) await this.landPost();
      return null;
    }

    const index = this.cursor;
    const event = events[index];
    if (this.pendingPost && this.pendingPost.landsAt <= event.t) await this.landPost();

    const at = Number(this.start) + event.t;
    const transfer = toTransfer(this.incident, event, at);
    const scoringStart = performance.now();
    const assessment = scoreTransfer({
      transfer,
      // The oracle refreshes its baseline continuously; it does not fold
      // attack traffic into it, so an attacker cannot poison it mid-incident.
      baseline: { ...ILLUSTRATIVE_BASELINE, route: this.incident.routeLabel, computedAt: at - 600 },
      recent: this.history,
      screening: SCREENING,
      now: at,
    });
    const scoringMs = performance.now() - scoringStart;
    const onChainScore = assessment.score === null ? 0n : toOnChainScore(assessment.score);
    const trips = assessment.verdict === 'trip';

    for (const s of STRATEGIES) this.guards[s].now = this.start + BigInt(event.t);

    // Pre-execution: the attestation lands before the release it is about.
    if (trips && !this.trips.pre) {
      this.trips.pre = await this.attest('pre', event.t, onChainScore, index, scoringStart);
    }

    const outcome = {} as Record<Strategy, Outcome>;
    for (const s of STRATEGIES) {
      outcome[s] = await this.release(s, event);
      const tally = this.totals[s];
      if (outcome[s] === 'released' && event.kind !== 'legit') tally.lostUsd += event.amountUsd;
      if (outcome[s] === 'blocked' && event.kind === 'legit') {
        tally.heldLegitUsd += event.amountUsd;
        tally.heldLegitCount += 1;
      }
    }

    // Post-inclusion: it saw the release only once it had executed, and its
    // attestation lands a block later.
    if (trips && !this.trips.post && !this.pendingPost) {
      this.pendingPost = { landsAt: event.t + BLOCK_SECONDS, riskScore: onChainScore, triggerIndex: index, scoringMs };
    }

    this.history.push(transfer);
    const record: StepRecord = { index, event, assessment, onChainScore, outcome };
    this.steps.push(record);
    this.cursor += 1;
    this.clock = event.t;
    if (this.cursor >= events.length && this.pendingPost) await this.landPost();
    await this.refreshRoutes(false);
    return record;
  }

  snapshot(): ReplaySnapshot {
    return {
      incident: this.incident,
      steps: [...this.steps],
      cursor: this.cursor,
      done: this.done,
      clock: this.clock,
      trips: { ...this.trips },
      totals: { pre: { ...this.totals.pre }, post: { ...this.totals.post } },
      realityLostUsd: this.incident.events
        .filter((e) => e.kind !== 'legit' && !e.stoppedInReality)
        .reduce((sum, e) => sum + e.amountUsd, 0),
      routes: { pre: [...this.routes.pre], post: [...this.routes.post] },
    };
  }

  // --- internals ---------------------------------------------------------------

  private async attest(
    strategy: Strategy,
    t: number,
    riskScore: bigint,
    triggerIndex: number,
    startedAt: number
  ): Promise<TripRecord> {
    const g = this.guards[strategy];
    g.now = this.start + BigInt(t);
    this.nonce[strategy] += 1n;
    const a = { routeId: this.route, riskScore, validUntil: g.now + 300n, nonce: this.nonce[strategy] };
    const signature = await signAttestation(actors.oracle, g.address, a, LOCAL_CHAIN_ID);
    const res = await g.send(actors.relayer, 'submitAttestation', [a.routeId, a.riskScore, a.validUntil, a.nonce, signature]);
    // Never show a pause the contract did not accept. This exact failure — an
    // oracle trip the guardian refused — shipped once already.
    if (!res.ok) throw new Error(`Guardian refused the attestation: ${res.error ?? 'unknown revert'}`);
    return {
      strategy,
      triggerIndex,
      landedAt: t,
      riskScore,
      gas: res.gas,
      computeMs: performance.now() - startedAt,
    };
  }

  private async landPost() {
    const p = this.pendingPost!;
    this.pendingPost = null;
    const signStart = performance.now();
    const trip = await this.attest('post', p.landsAt, p.riskScore, p.triggerIndex, signStart);
    this.trips.post = { ...trip, computeMs: trip.computeMs + p.scoringMs };
    this.clock = Math.max(this.clock, p.landsAt);
  }

  private async release(strategy: Strategy, event: IncidentEvent): Promise<Outcome> {
    const res = await this.guards[strategy].send(actors.bridge, 'onTokenOutflow', [
      this.route,
      BigInt(Math.round(event.amountUsd)),
    ]);
    if (res.ok) return 'released';
    if (res.error === 'RoutePaused') return 'blocked';
    // Anything else is a bug in the replay, not an outcome to display.
    throw new Error(`Unexpected guardian revert on release: ${res.error ?? 'unknown'}`);
  }

  private async refreshRoutes(includeIdle: boolean) {
    for (const s of STRATEGIES) {
      const g = this.guards[s];
      const read = async (key: Hex, chainLabel: string, routeLabel: string, incident: boolean): Promise<RouteView> => {
        const status = STATUS[Number(await g.read<number>('routeStatus', [key]))];
        const r = await g.read<{ outflowInWindow: bigint; pausedUntil: bigint }>('getRoute', [key]);
        return {
          key,
          chainLabel,
          routeLabel,
          status,
          windowOutflowUsd: Number(r.outflowInWindow),
          pausedUntil: status === 'PAUSED' ? Number(r.pausedUntil - this.start) : null,
          incident,
        };
      };
      const incidentRoute = await read(this.route, this.incident.chainLabel, this.incident.routeLabel, true);
      // Idle routes see no traffic, so they only need reading once.
      const idle = includeIdle
        ? await Promise.all(this.idle.map((r) => read(r.key, r.chainLabel, r.routeLabel, false)))
        : this.routes[s].slice(1);
      this.routes[s] = [incidentRoute, ...idle];
    }
  }
}

function toTransfer(incident: Incident, e: IncidentEvent, at: number): BridgeTransfer {
  return {
    hash: `${incident.id}-${e.t}`,
    chain: 'ethereum',
    route: incident.routeLabel,
    token: incident.routeLabel,
    amountUsd: e.amountUsd,
    timestamp: at,
    from: '0xbridge',
    to: e.to,
    claimedPayoutUsd: e.claimedPayoutUsd,
    provenBurnUsd: e.provenBurnUsd,
  };
}

async function expectOk(p: Promise<{ ok: boolean; error?: string }>, what: string) {
  const res = await p;
  if (!res.ok) throw new Error(`${what} reverted: ${res.error ?? 'unknown'}`);
}
