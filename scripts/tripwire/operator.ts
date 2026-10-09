// Durable release queue. HOLD, REJECT holds, guardian-delayed payouts and
// customer returns that have not matured remain pending.
import type { Hex } from 'viem';
import { z } from 'zod';
import type { AttestationOutcome, Attestor } from './attest.js';
import { FinalityConflictError } from './finality.js';
import { ReleaseDecision, settlementVerdict } from './settlement.js';
import type { DurableSender } from './sender.js';
import type { TransactionRequest } from './store.js';
import type { Observation, Watcher } from './watch.js';
import { paymentStatusSchema } from './testnet/paymentState.js';

export enum ReleaseState { PENDING, VERIFIED, HELD, REJECTED, EXECUTED }
const clock = z.object({ until: z.bigint().nonnegative(), now: z.bigint().nonnegative() });
const releaseStatusSchema = z.object({
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amount: z.bigint().positive(),
  state: z.number().int().min(0).max(4), nonce: z.bigint().nonnegative(),
  delay: clock.optional(),
  /** Policy v4: a REJECT holds until `until`, then a fresh review may reopen it. Absent: it never reopens. */
  rejection: clock.optional(),
  /** Customer payment escrow (ADR-028): policy version, approval, return clock. Absent on plain vaults. */
  payment: paymentStatusSchema.optional(),
});
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;
export interface ReleasePort {
  read(messageId: Hex): Promise<ReleaseStatus>;
  review(observation: Observation, nonce: bigint, decision?: ReleaseDecision): Promise<TransactionRequest>;
  canExecute(messageId: Hex): Promise<boolean>;
  execute(messageId: Hex): TransactionRequest;
  /** Real RPC ports must confirm terminal state at a hash-checked finalized block. */
  terminalFinalized(messageId: Hex, state: ReleaseStatus): Promise<boolean>;
  /** Permissionless completion only. The operator never initiates customer returns. */
  returnCredit?(messageId: Hex): TransactionRequest;
}
export interface OperatorResult {
  messageId: Hex; action: 'held' | 'delayed' | 'rejected' | 'executed' | 'return-pending' | 'returned' | 'retry';
  /** The settlement check that decided a hold or rejection (ADR-023), or what blocked a retry. */
  reason?: string;
}

export interface ReleaseOperatorOptions {
  /**
   * Re-check held and rejected releases on a growing interval (seconds,
   * doubling up to `max`) instead of every tick. They stay pending and unpaid
   * meanwhile. A REJECT is not re-checked before its hold ends. Off by default.
   */
  heldBackoff?: { initial: number; max: number };
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 512);

export class ReleaseOperator {
  private lock: Promise<unknown> = Promise.resolve();
  /** Consecutive held results per release, for the backoff. In memory: a restart re-checks everything. */
  private holds = new Map<Hex, number>();
  constructor(private watcher: Watcher, private sender: DurableSender, private attestor: Attestor,
    private port: ReleasePort, private routeId: Hex, private opts: ReleaseOperatorOptions = {}) {
    const backoff = opts.heldBackoff;
    if (backoff && !(Number.isInteger(backoff.initial) && backoff.initial >= 1 && Number.isInteger(backoff.max) && backoff.max >= backoff.initial)) {
      throw new Error('Held backoff needs whole seconds with 1 <= initial <= max.');
    }
  }

  tick(): Promise<OperatorResult[]> {
    const run = this.lock.then(() => this.poll(), () => this.poll()); this.lock = run.catch(() => undefined); return run;
  }

  private async poll(): Promise<OperatorResult[]> {
    // Check source/destination anchors BEFORE recovering signed work.
    const observations = await this.watcher.tick();
    if (this.watcher.quarantineReason) return observations.map((o) => ({ messageId: o.release.messageId, action: 'held' }));
    // Reviews and payouts share this sender. If its lane is stuck, route
    // protection still runs: attestations go through their own relayer (HIGH-1).
    let blocked: string | null = null;
    try { await this.sender.recover(); }
    catch (error) {
      if (this.watcher.quarantineReason || error instanceof FinalityConflictError) throw error;
      blocked = describe(error);
    }
    const results: OperatorResult[] = [];
    for (const observation of observations) {
      const { result, state } = await this.handle(observation, blocked);
      results.push(result); this.backoff(result, state);
    }
    return results;
  }

  private async handle(observation: Observation, blocked: string | null): Promise<{ result: OperatorResult; state?: ReleaseStatus }> {
    const { messageId } = observation.release;
    let state = await this.read(observation);
    // Customer payment escrow (ADR-028): a finished return is terminal, and a
    // requested one replaces the payout path. The operator never starts a
    // return; it only completes a matured one, which pays the fixed recipient.
    if (state.payment?.returned) {
      if (!(await this.finalized(messageId, state))) return { result: { messageId, action: 'retry' } };
      await this.watcher.acknowledge(messageId, 'returned');
      return { result: { messageId, action: 'returned' } };
    }
    if (state.payment && state.payment.returnAt > 0n) {
      if (state.state === ReleaseState.EXECUTED) throw new Error('Executed customer credit has a pending return. Reconcile.');
      if (observation.source.status !== 'verified' || !this.port.returnCredit) return { result: { messageId, action: 'held' }, state };
      if (state.payment.now < state.payment.returnAt) return { result: { messageId, action: 'return-pending' } };
      if (blocked) return { result: { messageId, action: 'retry', reason: `Release transactions are blocked: ${blocked}` } };
      const id = this.sender.nextAttemptId(`return/${messageId}/${state.payment.returnAt}`);
      if (!id) return { result: { messageId, action: 'retry' } };
      await this.sender.send(id, this.port.returnCredit(messageId));
      state = await this.read(observation);
      if (state.payment?.returned && await this.finalized(messageId, state)) {
        await this.watcher.acknowledge(messageId, 'returned');
        return { result: { messageId, action: 'returned' } };
      }
      return { result: { messageId, action: 'retry' } };
    }
    if (state.state === ReleaseState.EXECUTED) {
      if (!(await this.finalized(messageId, state))) return { result: { messageId, action: 'retry' } };
      await this.watcher.acknowledge(messageId, 'executed');
      return { result: { messageId, action: 'executed' } };
    }
    const verdict = settlementVerdict(observation);
    // A customer policy blocker (recipient, limit, approval, pause, stale policy)
    // turns an ALLOW into a HOLD; it never softens an established REJECT.
    const blockers = state.payment?.blockers ?? [];
    const decision = blockers.length && verdict.decision !== ReleaseDecision.REJECT ? ReleaseDecision.HOLD : verdict.decision;
    const reason = decision === verdict.decision ? verdict.reason : `Customer payment policy: ${blockers.join(', ')}`;
    // A REJECT is a hold, not an end (CRIT-2): it is never acknowledged. Once
    // the vault's hold lapses, only evidence that now passes every check may
    // reopen it, and the vault can pay only the request's own recipient. A
    // funded customer credit can also leave through its fixed return meanwhile.
    if (state.state === ReleaseState.REJECTED && !(decision === ReleaseDecision.ALLOW && rejectionLapsed(state))) {
      return { result: { messageId, action: 'rejected', reason: rejectionLapsed(state) ? reason
        : state.payment ? 'Rejected; a customer payment leaves only through its fixed return.'
          : `Rejected; reviewable again after ${state.rejection?.until.toString() ?? 'never'}.` }, state };
    }
    let protection: AttestationOutcome;
    try { protection = await this.attestor.handle(this.routeId, observation.assessment); }
    catch (error) {
      if (this.watcher.quarantineReason || error instanceof FinalityConflictError) throw error;
      return { result: { messageId, action: 'retry', reason: `Route protection was not submitted: ${describe(error)}` } };
    }
    if (protection.action === 'rejected' || protection.action === 'unavailable') return { result: { messageId, action: 'retry' } };
    // Pending/held vault states already block execution. Preserve the job
    // without signing the same HOLD repeatedly while data is missing.
    if (decision === ReleaseDecision.HOLD && state.state !== ReleaseState.VERIFIED) {
      return { result: { messageId, action: 'held', reason }, state };
    }
    // Keep reevaluating risk/protection, but do not spend a review nonce/gas
    // every tick during an already established per-request hold. At maturity
    // a fresh review is required; HOLD/REJECT can still revoke an old ALLOW now.
    // A changed customer policy needs a fresh review even while a delay runs.
    if (decision === ReleaseDecision.ALLOW && state.state === ReleaseState.VERIFIED &&
      (!state.payment || state.payment.reviewedVersion === state.payment.version) && state.delay && state.delay.now < state.delay.until) {
      return { result: { messageId, action: 'delayed' } };
    }
    if (blocked) return { result: { messageId, action: 'retry', reason: `Release transactions are blocked: ${blocked}` } };
    // Re-read the per-message nonce after route protection settles.
    state = await this.read(observation);
    const attempt = this.sender.nextAttemptId(`review/${messageId}/${state.nonce + 1n}`);
    if (!attempt) return { result: { messageId, action: 'retry' } };
    const review = await this.sender.send(attempt, await this.port.review(observation, state.nonce + 1n, decision));
    if (review.status !== 'confirmed' && !(review.status === 'included' && review.receiptStatus === 'success')) {
      return { result: { messageId, action: 'retry' } };
    }
    state = await this.read(observation);
    if (state.state === ReleaseState.REJECTED) return { result: { messageId, action: 'rejected', reason }, state };
    if (decision !== ReleaseDecision.ALLOW) return { result: { messageId, action: 'held', reason }, state };
    if (state.payment && (state.payment.blockers.length || state.payment.returnAt > 0n || state.payment.reviewedVersion !== state.payment.version)) {
      return { result: { messageId, action: 'held', reason: `Customer payment policy: ${state.payment.blockers.join(', ') || 'policy changed'}` }, state };
    }
    if (!(await this.port.canExecute(messageId))) return { result: { messageId, action: 'delayed' } };
    // A new review nonce identifies a consciously retried execution after a
    // recorded revert. Crashes replay the original raw tx through recover().
    const execution = await this.sender.send(`execute/${messageId}/${state.nonce}`, this.port.execute(messageId));
    state = await this.read(observation);
    if (execution.status === 'confirmed' && state.state === ReleaseState.EXECUTED && await this.finalized(messageId, state)) {
      await this.watcher.acknowledge(messageId, 'executed'); return { result: { messageId, action: 'executed' } };
    }
    return { result: { messageId, action: 'retry' } };
  }

  /** Space out re-checks of releases that are held or rejected; anything else resets the interval. */
  private backoff(result: OperatorResult, state?: ReleaseStatus): void {
    const backoff = this.opts.heldBackoff;
    if (!backoff) return;
    if (result.action !== 'held' && result.action !== 'rejected') { this.holds.delete(result.messageId); return; }
    const count = (this.holds.get(result.messageId) ?? 0) + 1;
    this.holds.set(result.messageId, count);
    let seconds = Math.min(backoff.max, backoff.initial * 2 ** Math.min(count - 1, 30));
    // Nothing can change a REJECT before its hold ends: sleep through it.
    if (state?.rejection && state.rejection.now < state.rejection.until) seconds = Number(state.rejection.until - state.rejection.now);
    this.watcher.snooze(result.messageId, seconds);
  }

  private async finalized(messageId: Hex, state: ReleaseStatus): Promise<boolean> {
    await this.watcher.assertCanonical();
    return this.port.terminalFinalized(messageId, state);
  }

  private async read(observation: Observation): Promise<ReleaseStatus> {
    const state = releaseStatusSchema.parse(await this.port.read(observation.release.messageId));
    if (state.recipient.toLowerCase() !== observation.release.recipient.toLowerCase() || state.amount !== observation.release.amount) {
      throw new Error('On-chain release does not match the observed request. Reconciliation required.');
    }
    return state;
  }
}

const rejectionLapsed = (state: ReleaseStatus) => state.rejection !== undefined && state.rejection.now >= state.rejection.until;
