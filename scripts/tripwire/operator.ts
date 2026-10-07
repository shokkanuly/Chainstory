// Durable release queue. HOLD and guardian-delayed payouts remain pending.
import type { Hex } from 'viem';
import { z } from 'zod';
import type { Attestor } from './attest.js';
import { ReleaseDecision, releaseDecision } from './review.js';
import type { DurableSender } from './sender.js';
import type { TransactionRequest } from './store.js';
import type { Observation, Watcher } from './watch.js';
import { paymentStatusSchema } from './testnet/paymentState.js';

export enum ReleaseState { PENDING, VERIFIED, HELD, REJECTED, EXECUTED }
const releaseStatusSchema = z.object({
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amount: z.bigint().positive(),
  state: z.number().int().min(0).max(4), nonce: z.bigint().nonnegative(),
  delay: z.object({ until: z.bigint().nonnegative(), now: z.bigint().nonnegative() }).optional(),
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
export interface OperatorResult { messageId: Hex; action: 'held' | 'delayed' | 'rejected' | 'executed' | 'return-pending' | 'returned' | 'retry' }

export class ReleaseOperator {
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private watcher: Watcher, private sender: DurableSender, private attestor: Attestor,
    private port: ReleasePort, private routeId: Hex) {}

  tick(): Promise<OperatorResult[]> {
    const run = this.lock.then(() => this.poll(), () => this.poll()); this.lock = run.catch(() => undefined); return run;
  }

  private async poll(): Promise<OperatorResult[]> {
    // Check source/destination anchors BEFORE recovering signed work.
    const observations = await this.watcher.tick();
    if (this.watcher.quarantineReason) return observations.map((o) => ({ messageId: o.release.messageId, action: 'held' }));
    await this.sender.recover();
    const results: OperatorResult[] = [];
    for (const observation of observations) {
      const { messageId } = observation.release;
      let state = await this.read(observation);
      if (state.payment?.returned) {
        if (!(await this.finalized(messageId, state))) { results.push({ messageId, action: 'retry' }); continue; }
        await this.watcher.acknowledge(messageId, 'returned'); results.push({ messageId, action: 'returned' }); continue;
      }
      if (state.payment && state.payment.returnAt > 0n) {
        if (state.state === ReleaseState.EXECUTED) throw new Error('Executed customer credit has a pending return. Reconcile.');
        if (observation.source.status !== 'verified' || !this.port.returnCredit) { results.push({ messageId, action: 'held' }); continue; }
        if (state.payment.now < state.payment.returnAt) { results.push({ messageId, action: 'return-pending' }); continue; }
        const id = this.sender.nextAttemptId(`return/${messageId}/${state.payment.returnAt}`);
        if (!id) { results.push({ messageId, action: 'retry' }); continue; }
        await this.sender.send(id, this.port.returnCredit(messageId));
        state = await this.read(observation);
        if (state.payment?.returned && await this.finalized(messageId, state)) {
          await this.watcher.acknowledge(messageId, 'returned'); results.push({ messageId, action: 'returned' });
        } else results.push({ messageId, action: 'retry' });
        continue;
      }
      if (state.state === ReleaseState.EXECUTED || state.state === ReleaseState.REJECTED) {
        if (!(await this.finalized(messageId, state))) { results.push({ messageId, action: 'retry' }); continue; }
        // A rejected funded payment still needs its customer's recovery path.
        if (!state.payment || state.state === ReleaseState.EXECUTED) await this.watcher.acknowledge(messageId,
          state.state === ReleaseState.EXECUTED ? 'executed' : 'rejected');
        results.push({ messageId, action: state.state === ReleaseState.EXECUTED ? 'executed' : 'rejected' }); continue;
      }
      const decision = state.payment?.blockers.length && releaseDecision(observation) !== ReleaseDecision.REJECT
        ? ReleaseDecision.HOLD : releaseDecision(observation);
      const protection = await this.attestor.handle(this.routeId, observation.assessment);
      if (protection.action === 'rejected' || protection.action === 'unavailable') { results.push({ messageId, action: 'retry' }); continue; }
      // Pending/held vault states already block execution. Preserve the job
      // without signing the same HOLD repeatedly while data is missing.
      if (decision === ReleaseDecision.HOLD && state.state !== ReleaseState.VERIFIED) {
        results.push({ messageId, action: 'held' }); continue;
      }
      // Keep reevaluating risk/protection, but do not spend a review nonce/gas
      // every tick during an already established per-request hold. At maturity
      // a fresh review is required; HOLD/REJECT can still revoke an old ALLOW now.
      if (decision === ReleaseDecision.ALLOW && state.state === ReleaseState.VERIFIED &&
        (!state.payment || state.payment.reviewedVersion === state.payment.version) && state.delay && state.delay.now < state.delay.until) {
        results.push({ messageId, action: 'delayed' }); continue;
      }
      // Re-read the per-message nonce after route protection settles.
      state = await this.read(observation);
      const attempt = this.sender.nextAttemptId(`review/${messageId}/${state.nonce + 1n}`);
      if (!attempt) { results.push({ messageId, action: 'retry' }); continue; }
      const review = await this.sender.send(attempt, await this.port.review(observation, state.nonce + 1n, decision));
      if (review.status !== 'confirmed' && !(review.status === 'included' && review.receiptStatus === 'success')) {
        results.push({ messageId, action: 'retry' }); continue;
      }
      state = await this.read(observation);
      if (state.state === ReleaseState.REJECTED) {
        if (!(await this.finalized(messageId, state))) { results.push({ messageId, action: 'retry' }); continue; }
        if (!state.payment) await this.watcher.acknowledge(messageId, 'rejected'); results.push({ messageId, action: 'rejected' }); continue;
      }
      if (decision !== ReleaseDecision.ALLOW) { results.push({ messageId, action: 'held' }); continue; }
      if (state.payment && (state.payment.blockers.length || state.payment.returnAt > 0n || state.payment.reviewedVersion !== state.payment.version)) {
        results.push({ messageId, action: 'held' }); continue;
      }
      if (!(await this.port.canExecute(messageId))) { results.push({ messageId, action: 'delayed' }); continue; }
      // A new review nonce identifies a consciously retried execution after a
      // recorded revert. Crashes replay the original raw tx through recover().
      const execution = await this.sender.send(`execute/${messageId}/${state.nonce}`, this.port.execute(messageId));
      state = await this.read(observation);
      if (execution.status === 'confirmed' && state.state === ReleaseState.EXECUTED && await this.finalized(messageId, state)) {
        await this.watcher.acknowledge(messageId, 'executed'); results.push({ messageId, action: 'executed' });
      } else results.push({ messageId, action: 'retry' });
    }
    return results;
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
