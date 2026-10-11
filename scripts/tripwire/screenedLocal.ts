// Synthetic local-chain fixture for the screened payment escrow (H4c3a, ADR-047).
// Screening digests come from the H4c2 TypeScript codec, so every accepted
// signature also proves the contract and the off-chain verifier agree.
// Synthetic keys only; no RPC, public transaction or real screening provider.
import { concatHex, encodeAbiParameters, keccak256, stringToHex, toHex, type Hex, type PrivateKeyAccount } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { actors, GuardianVM, LOCAL_CHAIN_ID } from '../../src/tripwire/guardianVM.js';
import guardian from '../../src/tripwire/guardian.artifact.js';
import demo from './testnet/contracts.artifact.js';
import screenedArtifact from './testnet/cctpScreenedPaymentEscrow.artifact.js';
import { cctpAddressWord, cctpPaymentHook } from '../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../src/chains/evm/registry/cctp.js';
import { screeningHeadHash, screeningPaymentContextHash, screeningProfileHash, screeningReceiptHash,
  type ScreeningPaymentContext, type ScreeningProfile, type ScreeningScope } from '../../src/chains/evm/screening.js';
import { NO_SCREENING, ReleaseDecision, signScreenedPaymentReleaseReview, type ReleaseReview } from './review.js';
import { ResponseTier } from '../../src/tripwire/onChain.js';
import { harness, LOCAL_PAYMENT_POLICY, PAYMENT_AMOUNT, PAYMENT_FEE, PAYMENT_NET, PAYMENT_NONCE, PAYMENT_OPERATION } from './paymentLocal.js';

export const SCREENED_ROUTE = keccak256(stringToHex('local-cctp-screened-payment'));
export const SCREENING_ISSUER = privateKeyToAccount(keccak256(stringToHex('tripwire-screening-fixture/issuer')));
export const SCREENING_STRANGER = privateKeyToAccount(keccak256(stringToHex('tripwire-screening-fixture/stranger')));
const HOOK_V2 = keccak256(stringToHex('Tripwire/CCTP/v2/USDC/payment/v2'));
export const NOT_LISTED = 1 as const, MATCHED = 2 as const, UNKNOWN = 0 as const;
export const DAY = 86_400n;
type ReleaseTuple = [Hex, bigint, number, bigint, Hex, bigint, number];
const u32 = (n: number) => toHex(n, { size: 4 });
const u256 = (n: bigint) => toHex(n, { size: 32 });
export const screenedReleaseId = (vault: Hex, nonce: Hex) => keccak256(encodeAbiParameters(
  [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint32' }, { type: 'bytes32' }],
  [keccak256(stringToHex('Tripwire/CCTP/v2/payment-escrow/v2')), BigInt(LOCAL_CHAIN_ID), vault, 6, nonce]));

export interface ProfileInput { providerIdHash: Hex; listIdHash: Hex; issuer: Hex; maxObservationAgeSeconds: number; maxSnapshotAgeSeconds: number }
export const LOCAL_PROFILE: ProfileInput = { providerIdHash: keccak256(stringToHex('synthetic-provider')),
  listIdHash: keccak256(stringToHex('synthetic-list')), issuer: SCREENING_ISSUER.address, maxObservationAgeSeconds: 300, maxSnapshotAgeSeconds: 3600 };

export async function deployScreenedEscrow(vm: GuardianVM, token: Hex, transmitter: Hex, profile: ProfileInput = LOCAL_PROFILE, policy = LOCAL_PAYMENT_POLICY) {
  return vm.deployContract(screenedArtifact, [token, vm.address, SCREENED_ROUTE,
    { transmitter, destinationMessenger: actors.bridge.address, sourceDomain: 6, sourceMessenger: route.source.messenger, sourceToken: route.source.usdc },
    { authority: actors.owner.address, returnRecipient: actors.bridge.address, sourceSender: actors.owner.address, recoveryDelay: 3600n,
      policy, recipients: [actors.attacker.address] }, profile]);
}

/** Deployed, unpaused through the customer's one-day queue, funded once, with an active issuer head. */
export async function screenedLocalFixture(opts: { amount?: bigint; register?: boolean } = {}) {
  const vm = await GuardianVM.deploy(guardian);
  const token = await vm.deployContract(demo.DemoUSDC, [actors.owner.address]);
  const transmitter = await vm.deployContract(harness, [actors.relayer.address, token.address]);
  const vault = await deployScreenedEscrow(vm, token.address, transmitter.address);
  await vm.sendContract(token, actors.owner, 'mint', [vault.address, PAYMENT_NET * 10n]);
  await vm.sendContract(token, actors.owner, 'transferOwnership', [transmitter.address]);
  await vm.send(actors.owner, 'configureRoute', [SCREENED_ROUTE, 100_000_000n, 3600n]);
  await vm.send(actors.owner, 'setProtected', [vault.address, SCREENED_ROUTE, true]);
  const unpause = await vm.sendContract(vault, actors.owner, 'scheduleUnpause', []);
  vm.warp(DAY); const applied = await vm.sendContract(vault, actors.relayer, 'applyUnpause', []);
  if (!unpause.ok || !applied.ok) throw new Error('Fixture could not unpause the screened escrow.');
  const scope: ScreeningScope = { destinationChainId: BigInt(LOCAL_CHAIN_ID), vault: vault.address.toLowerCase() as Hex,
    guardian: vm.address.toLowerCase() as Hex, routeId: SCREENED_ROUTE, token: token.address.toLowerCase() as Hex };
  const profileFor = (p: ProfileInput): ScreeningProfile => ({ version: 1, providerIdHash: p.providerIdHash, listIdHash: p.listIdHash,
    issuer: p.issuer.toLowerCase() as Hex, subject: 'payout-recipient', maxObservationAgeSeconds: BigInt(p.maxObservationAgeSeconds),
    maxSnapshotAgeSeconds: BigInt(p.maxSnapshotAgeSeconds) });
  const profileHash = (p: ProfileInput = LOCAL_PROFILE) => screeningProfileHash(scope, profileFor(p));
  const intentPolicyHash = await vm.readContract<Hex>(vault, 'policyHash');
  const id = screenedReleaseId(vault.address, PAYMENT_NONCE);
  const amount = opts.amount ?? PAYMENT_AMOUNT;

  const message = (over: Partial<{ nonce: Hex; operationId: Hex; amount: bigint }> = {}) => {
    const hook = `${HOOK_V2}${cctpPaymentHook({ recipient: actors.attacker.address, returnRecipient: actors.bridge.address,
      operationId: over.operationId ?? PAYMENT_OPERATION, policyHash: intentPolicyHash }).slice(66)}` as Hex;
    const body = concatHex([u32(1), cctpAddressWord(route.source.usdc), cctpAddressWord(vault.address), u256(over.amount ?? amount),
      cctpAddressWord(actors.owner.address), u256(1000n), u256(PAYMENT_FEE), u256(0n), hook]);
    return concatHex([u32(1), u32(6), u32(0), over.nonce ?? PAYMENT_NONCE, cctpAddressWord(route.source.messenger),
      cctpAddressWord(actors.bridge.address), cctpAddressWord(vault.address), u32(2000), u32(2000), body]);
  };
  const receive = async (raw = message()) => vm.sendContract(vault, actors.attacker, 'receiveCctp', [raw, await actors.relayer.sign({ hash: keccak256(raw) })]);

  // --- screening evidence, signed over the H4c2 TypeScript digests ---
  const headFields = (over: Partial<{ revision: bigint; snapshotDigest: Hex; listAsOf: bigint; validUntil: bigint; profileHash: Hex }> = {}) => {
    const listAsOf = over.listAsOf ?? vm.now;
    return { profileHash: over.profileHash ?? profileHash(), revision: over.revision ?? 1n, snapshotDigest: over.snapshotDigest ?? keccak256(stringToHex('snapshot-1')),
      listAsOf, validUntil: over.validUntil ?? listAsOf + 3600n };
  };
  const registerHead = async (over: Parameters<typeof headFields>[0] = {}, signer: PrivateKeyAccount = SCREENING_ISSUER) => {
    const head = headFields(over); const hash = screeningHeadHash(scope, head);
    const result = await vm.sendContract(vault, actors.attacker, 'registerScreeningHead',
      [head.revision, head.snapshotDigest, head.listAsOf, head.validUntil, await signer.sign({ hash })]);
    return { ...result, head, hash };
  };
  const policy = async () => ({ version: await vm.readContract<bigint>(vault, 'policyVersion'), hash: await vm.readContract<Hex>(vault, 'policyHash') });
  const context = async (messageId = id): Promise<ScreeningPaymentContext> => {
    const r = await vm.readContract<ReleaseTuple>(vault, 'releases', [messageId]);
    const c = await vm.readContract<[Hex, Hex, Hex, bigint, boolean]>(vault, 'credits', [messageId]);
    const p = await policy();
    return { ...scope, sourceSender: actors.owner.address.toLowerCase() as Hex, policyVersion: p.version, policyHash: p.hash, messageId,
      operationId: c[1], recipient: r[0].toLowerCase() as Hex, amount: r[1], returnRecipient: c[0].toLowerCase() as Hex, intentPolicyHash: c[2] };
  };
  const activeHead = async () => (await vm.readContract<[Hex, bigint, bigint, bigint]>(vault, 'activeHead'))[0];
  type ReceiptFields = { profileHash: Hex; headHash: Hex; paymentContextHash: Hex; outcome: 0 | 1 | 2; checkedAt: bigint; validUntil: bigint };
  const receipt = async (over: Partial<ReceiptFields> = {}, signer: PrivateKeyAccount = SCREENING_ISSUER, messageId = id) => {
    const fields: ReceiptFields = { profileHash: profileHash(), headHash: await activeHead(), paymentContextHash: screeningPaymentContextHash(await context(messageId)),
      outcome: NOT_LISTED, checkedAt: vm.now, validUntil: vm.now + 300n, ...over };
    const hash = screeningReceiptHash(scope, fields);
    return { fields, hash, signature: await signer.sign({ hash }) };
  };
  const reviewData = async (messageId = id, over: Partial<ReleaseReview> = {}): Promise<ReleaseReview> => {
    const r = await vm.readContract<ReleaseTuple>(vault, 'releases', [messageId]);
    return { messageId, routeId: SCREENED_ROUTE, token: token.address, recipient: r[0], amount: r[1], decision: ReleaseDecision.ALLOW,
      minimumTier: ResponseTier.NONE, validUntil: vm.now + 300n, nonce: r[5] + 1n, ...over };
  };
  /** ALLOW with a receipt: the oracle's format-4 review commits to the receipt it was shown. */
  const allow = async (evidence?: Awaited<ReturnType<typeof receipt>>, over: Partial<ReleaseReview> = {}, messageId = id,
    commitments?: { receiptHash: Hex; headHash: Hex; validUntil: bigint }) => {
    const e = evidence ?? await receipt({}, SCREENING_ISSUER, messageId);
    const review = await reviewData(messageId, over);
    const signature = await signScreenedPaymentReleaseReview(actors.oracle, vault.address, review, await policy(),
      commitments ?? { receiptHash: e.hash, headHash: e.fields.headHash, validUntil: e.fields.validUntil }, LOCAL_CHAIN_ID);
    return vm.sendContract(vault, actors.relayer, 'reviewScreenedRelease',
      [messageId, review.minimumTier, review.validUntil, review.nonce, signature, e.fields, e.signature]);
  };
  /** HOLD, REJECT or a bare ALLOW with zero screening commitments, through the plain entry point. */
  const plainReview = async (decision: ReleaseDecision, messageId = id, over: Partial<ReleaseReview> = {}) => {
    const review = await reviewData(messageId, { decision, ...over });
    const signature = await signScreenedPaymentReleaseReview(actors.oracle, vault.address, review, await policy(), NO_SCREENING, LOCAL_CHAIN_ID);
    return vm.sendContract(vault, actors.relayer, 'reviewRelease', [messageId, decision, review.minimumTier, review.validUntil, review.nonce, signature]);
  };
  const execute = (messageId = id) => vm.sendContract(vault, actors.relayer, 'executeRelease', [messageId]);
  const requestReturn = (messageId = id) => vm.sendContract(vault, actors.bridge, 'requestReturn', [messageId]);
  const executeReturn = (messageId = id) => vm.sendContract(vault, actors.relayer, 'executeReturn', [messageId]);
  const funded = await receive();
  if (!funded.ok) throw new Error(`Fixture funding failed: ${funded.error}`);
  if (opts.register !== false) { const h = await registerHead(); if (!h.ok) throw new Error(`Fixture head failed: ${h.error}`); }
  return { vm, token, transmitter, vault, id, scope, profileFor, profileHash, message, receive, registerHead, headFields, context, receipt,
    reviewData, allow, plainReview, policy, execute, requestReturn, executeReturn, activeHead };
}
