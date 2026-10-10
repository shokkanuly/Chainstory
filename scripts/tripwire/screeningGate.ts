// The operator's screening gate (H4c3b, ADR-048). Before an ALLOW on a
// screened escrow it asks the provider adapter for issuer-signed evidence,
// journals the original envelopes, relays a newer list head if the evidence
// carries one, and verifies the receipts with the H4c2 verifier against the
// state read at one hash-checked block. Only a verified NOT_LISTED for the
// active head and this exact payment passes. Everything else holds:
// MATCHED, UNKNOWN, missing, outage, invalid, expired or contradictory.
//
// A contradiction is retained for its profile/head/payment scope: a later
// clean receipt for the same head never clears it ("newest wins" is refused).
// Only a new issuer head (or a changed payment context) starts a fresh scope.
import { encodeFunctionData, type Hex, type LocalAccount } from 'viem';
import { z } from 'zod';
import { screeningUnavailable, type ScreeningEvidence } from '../../src/domain/screening.js';
import {
  screeningHeadEnvelopeSchema, screeningHeadHash, screeningHeadTransition, screeningReceiptEnvelopeSchema, screeningReceiptHash,
  verifyScreeningEvidence, type ScreeningProfile, type ScreeningScope,
} from '../../src/chains/evm/screening.js';
import type { ReleaseStatus, ReviewScreening } from './operator.js';
import type { Observation } from './watch.js';
import { NO_SCREENING, ReleaseDecision, releaseMinimumTier, signScreenedPaymentReleaseReview, type ReleaseReview } from './review.js';
import { ResponseTier } from '../../src/tripwire/onChain.js';
import type { DurableSender } from './sender.js';
import type { OperatorStore, ScreeningRecord, TransactionRequest } from './store.js';
import { ZERO_WORD, type ScreeningStatus } from './testnet/screenedState.js';
import screenedArtifact from './testnet/cctpScreenedPaymentEscrow.artifact.js';

/** What a provider adapter returns: signed evidence, or a typed absence. Never free text. */
export type ScreeningFetch = { status: 'missing' } | { status: 'provider-unavailable' } | { status: 'available'; head: unknown; receipts: readonly unknown[] };
export interface ScreeningRequest {
  messageId: Hex; profileHash: Hex; paymentContextHash: Hex;
  /** The head the escrow has active, if any; the provider may answer for it or a newer one. */
  activeHeadHash: Hex | null;
}
export interface ScreeningProvider {
  /** A thrown error counts as `provider-unavailable`; its message never becomes a reason. */
  fetch(request: ScreeningRequest): Promise<ScreeningFetch>;
}
const fetchSchema = z.union([z.object({ status: z.enum(['missing', 'provider-unavailable']) }).strict(),
  z.object({ status: z.literal('available'), head: z.unknown(), receipts: z.array(z.unknown()).max(64) }).strict()]);

/** The accepted receipt a format-4 ALLOW is submitted with. */
export interface ScreeningProof {
  receipt: { profileHash: Hex; headHash: Hex; paymentContextHash: Hex; outcome: 1; checkedAt: bigint; validUntil: bigint };
  signature: Hex; receiptHash: Hex;
}
export type ScreeningGateResult =
  | { status: 'passed'; proof: ScreeningProof; state: ReleaseStatus }
  | { status: 'held'; reason: string }
  | { status: 'retry'; reason: string };
export interface ScreeningCheck { check(messageId: Hex, state: ReleaseStatus): Promise<ScreeningGateResult> }

/** H4c2's transport form: canonical decimal strings for integers. */
const wire = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));

export class ScreeningGate implements ScreeningCheck {
  constructor(private deps: {
    store: OperatorStore; sender: DurableSender; provider: ScreeningProvider;
    /** The accepted deployment's screening scope and profile (manifest 4). */
    scope: ScreeningScope; profile: ScreeningProfile;
    /** The operator's coherent reader; used again after a head relay. */
    read(messageId: Hex): Promise<ReleaseStatus>;
  }) {}

  async check(messageId: Hex, state: ReleaseStatus): Promise<ScreeningGateResult> {
    let s = state.screening;
    if (!s) return { status: 'held', reason: 'Screening state is unavailable.' };
    if (!s.accepted || s.profileHash === ZERO_WORD) return { status: 'held', reason: 'Screening profile is revoked or is not the accepted profile.' };
    let fetched: ScreeningFetch;
    try {
      fetched = fetchSchema.parse(await this.deps.provider.fetch({ messageId, profileHash: s.profileHash, paymentContextHash: s.contextHash,
        activeHeadHash: s.head.hash === ZERO_WORD ? null : s.head.hash }));
    } catch { fetched = { status: 'provider-unavailable' }; }
    // The original signed envelopes are journaled before anything is relayed or signed.
    this.save({ kind: 'evidence', ...this.scopeOf(messageId, s), block: { number: s.block.number.toString(), hash: s.block.hash },
      now: s.now.toString(), evidence: fetched.status === 'available' ? { ...fetched, receipts: [...fetched.receipts] } : fetched });
    let current = state;
    if (fetched.status === 'available') {
      const relay = await this.relayHead(fetched.head, s);
      if (relay.status === 'retry') return relay;
      if (relay.status === 'relayed') {
        current = await this.deps.read(messageId);
        s = current.screening;
        if (!s || !s.accepted || s.profileHash === ZERO_WORD) return { status: 'held', reason: 'Screening profile changed while relaying its head.' };
      }
    }
    const scope = this.scopeOf(messageId, s);
    const result = await this.verify(fetched, s, scope);
    if (result.status === 'verified' && result.outcome === 'NOT_LISTED') {
      const proof = this.proofFor(fetched, result.receiptHash as Hex);
      if (proof) return { status: 'passed', proof, state: current };
      return { status: 'held', reason: 'Screening receipt could not be matched to its verified digest.' };
    }
    return { status: 'held', reason: `Screening: ${result.status === 'verified' ? result.outcome : result.reason}.` };
  }

  /**
   * Verify, journal the verifier's own result, then apply the journal's memory
   * of this scope: two different authenticated outcomes ever seen for the same
   * profile, head and payment are a retained contradiction.
   */
  private async verify(fetched: ScreeningFetch, s: ScreeningStatus, scope: ReturnType<ScreeningGate['scopeOf']>): Promise<ScreeningEvidence> {
    const now = s.now.toString();
    const result: ScreeningEvidence = s.head.hash === ZERO_WORD ? screeningUnavailable('head-mismatch') : await verifyScreeningEvidence({
      scope: wire(this.deps.scope), profile: wire(this.deps.profile), roles: s.roles, activeHeadHash: s.head.hash,
      paymentContext: wire(s.context), now, evidence: fetched as Parameters<typeof verifyScreeningEvidence>[0]['evidence'] });
    this.save(result.status === 'verified'
      ? { kind: 'result', ...scope, now, status: 'verified', outcome: result.outcome, receiptHash: result.receiptHash }
      : { kind: 'result', ...scope, now, status: 'unavailable', reason: result.reason });
    const records = this.deps.store.screeningRecords(scope.messageId).filter((r) => r.profileHash === scope.profileHash &&
      r.headHash === scope.headHash && r.contextHash === scope.contextHash);
    const outcomes = [...new Set(records.flatMap((r) => r.kind === 'result' && r.outcome ? [r.outcome] : []))];
    const retained = records.some((r) => r.kind === 'incident');
    const contradictory = outcomes.length > 1 || (result.status === 'unavailable' && result.reason === 'contradictory');
    if (contradictory && !retained) this.save({ kind: 'incident', ...scope, now, reason: 'contradictory', outcomes });
    return retained || contradictory ? screeningUnavailable('contradictory') : result;
  }

  /**
   * Relay a newer issuer head through the release lane. A head that is not
   * newer, is malformed or is out of time is never relayed: verification then
   * reports why it cannot be used. The escrow re-checks everything on chain.
   */
  private async relayHead(raw: unknown, s: ScreeningStatus): Promise<{ status: 'unchanged' | 'relayed' } | { status: 'retry'; reason: string }> {
    const parsed = screeningHeadEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return { status: 'unchanged' };
    const { head, signature } = parsed.data;
    const hash = screeningHeadHash(this.deps.scope, head);
    if (hash === s.head.hash || (s.head.hash !== ZERO_WORD && (head.revision <= s.head.revision || head.listAsOf < s.head.listAsOf))) return { status: 'unchanged' };
    const transition = await screeningHeadTransition({ scope: wire(this.deps.scope), profile: wire(this.deps.profile), previous: null, next: raw, now: s.now.toString() });
    if (transition.status === 'unavailable') return { status: 'unchanged' };
    const id = this.deps.sender.nextAttemptId(`screening-head/${hash}`);
    if (!id) return { status: 'retry', reason: 'Screening head relay is still pending.' };
    const sent = await this.deps.sender.send(id, { to: this.deps.scope.vault, value: '0', data: encodeFunctionData({ abi: screenedArtifact.abi,
      functionName: 'registerScreeningHead', args: [head.revision, head.snapshotDigest, head.listAsOf, head.validUntil, signature] }) });
    if (sent.status !== 'confirmed' && !(sent.status === 'included' && sent.receiptStatus === 'success')) {
      return { status: 'retry', reason: 'Screening head relay did not confirm.' };
    }
    return { status: 'relayed' };
  }

  private proofFor(fetched: ScreeningFetch, receiptHash: Hex): ScreeningProof | null {
    if (fetched.status !== 'available') return null;
    for (const raw of fetched.receipts) {
      const parsed = screeningReceiptEnvelopeSchema.safeParse(raw);
      if (!parsed.success || parsed.data.receipt.outcome !== 1) continue;
      const { receipt, signature } = parsed.data;
      if (screeningReceiptHash(this.deps.scope, receipt) === receiptHash) return { receipt: { ...receipt, outcome: 1 }, signature, receiptHash };
    }
    return null;
  }

  private scopeOf(messageId: Hex, s: ScreeningStatus) {
    return { messageId, profileHash: s.profileHash, headHash: s.head.hash, contextHash: s.contextHash };
  }

  private save(record: ScreeningRecord) { this.deps.store.saveScreeningRecord(record); }
}

/** Review lifetime when no receipt shortens it: well inside the vault's 600-second maximum. */
const REVIEW_TTL = 300n;

/**
 * Format-4 review for a screened escrow, from state read at one block. ALLOW
 * goes through `reviewScreenedRelease` with the accepted receipt, its review
 * expiring no later than the receipt; HOLD and REJECT go through
 * `reviewRelease` with zero screening commitments, so an outage never blocks a
 * revocation. In advisory mode the minimum tier is NONE: no heuristic score
 * selects a guardian tier.
 */
export async function screenedReviewRequest(input: {
  signer: LocalAccount; chainId: number; routeId: Hex; token: Hex;
  state: ReleaseStatus; observation: Observation; nonce: bigint; decision: ReleaseDecision; screening?: ReviewScreening;
}): Promise<TransactionRequest> {
  const { state, observation, decision, screening } = input;
  const payment = state.payment, screened = state.screening;
  if (!payment || !screened) throw new Error('Screened review needs customer payment and screening state.');
  const vault = screened.context.vault;
  if (state.nonce + 1n !== input.nonce || payment.returnAt > 0n || payment.returned || state.state >= 3 ||
    state.recipient.toLowerCase() !== observation.release.recipient.toLowerCase() || state.amount !== observation.release.amount) {
    throw new Error('Customer credit changed before review. Retry with fresh state.');
  }
  const proof = screening?.proof;
  if (decision === ReleaseDecision.ALLOW && (!proof || payment.blockers.length || observation.source.status !== 'verified' ||
    proof.receipt.paymentContextHash !== screened.contextHash || proof.receipt.headHash !== screened.head.hash)) {
    throw new Error('Screened payment is not eligible for ALLOW at this state.');
  }
  if (decision !== ReleaseDecision.ALLOW && proof) throw new Error('HOLD and REJECT carry no screening receipt.');
  const ttl = payment.now + REVIEW_TTL;
  const review: ReleaseReview = { messageId: observation.release.messageId, routeId: input.routeId, token: input.token,
    recipient: observation.release.recipient, amount: observation.release.amount, decision,
    minimumTier: screening?.advisory ? ResponseTier.NONE : releaseMinimumTier(observation),
    validUntil: proof && proof.receipt.validUntil < ttl ? proof.receipt.validUntil : ttl, nonce: input.nonce };
  const policy = { version: payment.version, hash: payment.hash };
  if (proof) {
    const signature = await signScreenedPaymentReleaseReview(input.signer, vault, review, policy,
      { receiptHash: proof.receiptHash, headHash: proof.receipt.headHash, validUntil: proof.receipt.validUntil }, input.chainId);
    return { to: vault, value: '0', data: encodeFunctionData({ abi: screenedArtifact.abi, functionName: 'reviewScreenedRelease',
      args: [review.messageId, review.minimumTier, review.validUntil, review.nonce, signature, proof.receipt, proof.signature] }) };
  }
  const signature = await signScreenedPaymentReleaseReview(input.signer, vault, review, policy, NO_SCREENING, input.chainId);
  return { to: vault, value: '0', data: encodeFunctionData({ abi: screenedArtifact.abi, functionName: 'reviewRelease',
    args: [review.messageId, review.decision, review.minimumTier, review.validUntil, review.nonce, signature] }) };
}
