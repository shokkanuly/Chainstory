// Single-step unsigned preparation. Never signs/sends or invents future state.
import { keccak256, stringToHex, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema, cctpAddressWord, cctpBytesSchema } from '../../../src/chains/evm/cctp.js';
import { boundedUsdcApprovalData, standardPaymentBurnData } from '../../../src/chains/evm/cctpBurn.js';
import { evmCodeSchema } from '../../../src/chains/evm/runtime.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { blockHashSchema, blockHeaderSchema, FinalityConflictError, receiptFinality } from '../finality.js';
import { acceptCctpDeployment, readInitialDeploymentState, type DeploymentAcceptanceReader } from './cctpDeploymentAcceptance.js';
import { cctpPaymentDeploymentSchema } from './cctpDeployPlan.js';
import { stringifyPublic } from './cctpPreflight.js';

const uint = z.bigint().nonnegative().max((1n << 256n) - 1n);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(BigInt).refine((n) => n < (1n << 256n));
// A chosen first-pilot limit, not Circle's protocol limit or a production policy.
export const FIRST_PAYMENT_MAX = 1_000_000n;
export const firstPaymentRequestSchema = z.object({ version: z.literal(1),
  grossBurnBaseUnits: decimal.refine((n) => n > 1n && n <= FIRST_PAYMENT_MAX), maxFeeBaseUnits: decimal,
  recipient: cctpAddressSchema.refine((a) => !/^0x0{40}$/.test(a)),
  operationId: blockHashSchema.refine((h) => !/^0x0{64}$/.test(h)),
  reservedBurnNonce: decimal.refine((n) => n <= BigInt(Number.MAX_SAFE_INTEGER - 2)),
}).strict().refine((r) => r.maxFeeBaseUnits < r.grossBurnBaseUnits);
export interface FirstPaymentSource {
  getChainId(): Promise<unknown>;
  getBlock(args: { blockTag: 'latest' } | { blockNumber: bigint }): Promise<unknown>;
  getBalance(address: Hex, block: bigint): Promise<unknown>;
  getCode(address: Hex, block: bigint): Promise<unknown>;
  readToken(name: 'decimals' | 'balanceOf' | 'allowance', block: bigint, args?: readonly Hex[]): Promise<unknown>;
  readMessenger(name: 'getMinFeeAmount' | 'remoteTokenMessengers' | 'localMessageTransmitter', block: bigint, args?: readonly (bigint | number)[]): Promise<unknown>;
  getNonce(address: Hex, block: bigint | 'pending'): Promise<unknown>;
  simulate(address: Hex, to: Hex, data: Hex, block: bigint): Promise<unknown>;
  estimate(address: Hex, to: Hex, data: Hex, block: bigint): Promise<unknown>;
}
export interface FirstPaymentDestination extends DeploymentAcceptanceReader {
  getLatestBlock(): Promise<unknown>;
  getBalance(address: Hex, block: bigint): Promise<unknown>;
}
const nonce = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export async function prepareFirstPayment(input: unknown, receiptInput: unknown, requestInput: unknown,
  source: FirstPaymentSource, destination: FirstPaymentDestination) {
  const config = cctpPaymentDeploymentSchema.parse(input), request = firstPaymentRequestSchema.parse(requestInput);
  const accepted = await acceptCctpDeployment(input, receiptInput, destination);
  const base = { version: 1, mode: 'keyless-first-standard-payment', enforcement: false, submittedTransactions: 0,
    packageHash: accepted.packageHash, requestHash: keccak256(stringToHex(stringifyPublic(request))), request,
    route: route.id, sourceChainId: route.source.chainId, destinationChainId: route.destination.chainId };
  if (!accepted.initialDeploymentAccepted) return { ...base, status: 'blocked' as const, blockers: accepted.blockers,
    nextTransaction: null, deploymentAcceptance: accepted };
  if (nonce.parse(await source.getChainId()) !== route.source.chainId) throw new Error('First payment source RPC is not Base Sepolia.');
  const src = blockHeaderSchema.parse(await source.getBlock({ blockTag: 'latest' }));
  const dst = blockHeaderSchema.parse(await destination.getLatestBlock());
  if (dst.number < accepted.finalized.number) throw new Error('Current destination state is behind accepted deployment.');
  const initial = await readInitialDeploymentState(input, destination, dst.number, accepted.evidence);
  if (z.boolean().parse(await destination.readVault('usedOperations', dst.number, [request.operationId]))) throw new Error('Business operation is already funded.');
  for (const address of [route.source.usdc, route.source.messenger, route.source.transmitter]) {
    if (evmCodeSchema.parse(await source.getCode(address, src.number)) === '0x') throw new Error('Pinned source Circle contract has no code.');
  }
  if (evmCodeSchema.parse(await source.getCode(config.payment.sourceSender, src.number)) !== '0x') throw new Error('First pilot requires the configured source EOA; delegated/smart-account execution needs separate integration.');
  if (z.number().int().parse(await source.readToken('decimals', src.number)) !== route.decimals) throw new Error('Source token decimals differ from USDC.');
  if (cctpAddressSchema.parse(await source.readMessenger('localMessageTransmitter', src.number)) !== route.source.transmitter ||
    blockHashSchema.parse(await source.readMessenger('remoteTokenMessengers', src.number, [route.destination.domain])) !== cctpAddressWord(route.destination.messenger)) {
    throw new Error('Source Circle messenger route bindings changed.');
  }
  const balance = uint.parse(await source.readToken('balanceOf', src.number, [config.payment.sourceSender]));
  const allowance = uint.parse(await source.readToken('allowance', src.number, [config.payment.sourceSender, route.source.messenger]));
  const ethWei = uint.parse(await source.getBalance(config.payment.sourceSender, src.number));
  const minFee = uint.parse(await source.readMessenger('getMinFeeAmount', src.number, [request.grossBurnBaseUnits]));
  if (minFee >= request.grossBurnBaseUnits) throw new Error('Standard fee quote cannot leave a positive customer credit.');
  const currentNonce = nonce.parse(await source.getNonce(config.payment.sourceSender, src.number));
  const pendingNonce = nonce.parse(await source.getNonce(config.payment.sourceSender, 'pending'));
  const approvalSteps = allowance === request.grossBurnBaseUnits ? 0n : allowance === 0n ? 1n : 2n;
  const blockers: string[] = [];
  if (pendingNonce !== currentNonce) blockers.push('SOURCE_TRANSACTIONS_PENDING');
  if (BigInt(currentNonce) + approvalSteps !== request.reservedBurnNonce) blockers.push('RESERVED_BURN_NONCE_CHANGED: reconcile this intent; never silently move a previously used burn nonce.');
  if (balance < request.grossBurnBaseUnits) blockers.push('SOURCE_USDC_SHORTFALL');
  if (ethWei === 0n) blockers.push('SOURCE_GAS_EMPTY');
  if (request.maxFeeBaseUnits < minFee) blockers.push('STANDARD_FEE_ABOVE_SELECTED_CAP');
  if (!config.payment.recipients.includes(request.recipient)) blockers.push('RECIPIENT_NOT_IN_INITIAL_POLICY');
  if (request.grossBurnBaseUnits > config.payment.policy.maxPayment || request.grossBurnBaseUnits > config.capBaseUnits) blockers.push('AMOUNT_EXCEEDS_INITIAL_POLICY_OR_ROUTE_CAP');
  if (request.grossBurnBaseUnits > config.payment.policy.manualApprovalAbove) blockers.push('FIRST_PAYMENT_REQUIRES_CUSTOMER_APPROVAL: use the separate post-mint approval workflow.');
  for (const address of new Set([config.owner, config.oracle, config.payment.authority, config.payment.returnRecipient])) {
    if (uint.parse(await destination.getBalance(address, dst.number)) === 0n) blockers.push(`DESTINATION_GAS_EMPTY:${address}`);
  }
  const snapshots = { source: src, destination: dst, initialAcceptance: accepted.finalized };
  const funding = { usdcBaseUnits: balance, allowanceBaseUnits: allowance, sourceEthWei: ethWei, currentNonce, pendingNonce };
  const fee = { minimumBaseUnits: minFee, selectedMaximumBaseUnits: request.maxFeeBaseUnits, grossBurnBaseUnits: request.grossBurnBaseUnits,
    capCoversMinimum: request.maxFeeBaseUnits >= minFee,
    netRange: request.maxFeeBaseUnits < minFee ? null : {
      minimumBaseUnits: request.grossBurnBaseUnits - request.maxFeeBaseUnits, maximumAtQuotedMinimum: request.grossBurnBaseUnits - minFee } };
  let nextTransaction: { purpose: 'reset-allowance' | 'approve-exact-amount' | 'standard-burn'; chainId: number; from: Hex; to: Hex;
    nonce: number; data: Hex; value: string; gasEstimate: bigint } | null = null;
  const intent = { recipient: request.recipient, returnRecipient: config.payment.returnRecipient, operationId: request.operationId, policyHash: initial.expectedPolicyHash };
  if (!blockers.length) {
    const purpose = allowance === request.grossBurnBaseUnits ? 'standard-burn' : allowance === 0n ? 'approve-exact-amount' : 'reset-allowance';
    const to = purpose === 'standard-burn' ? route.source.messenger : route.source.usdc;
    const data = purpose === 'standard-burn'
      ? standardPaymentBurnData(accepted.contracts.vault, request.grossBurnBaseUnits, request.maxFeeBaseUnits, intent)
      : boundedUsdcApprovalData(purpose === 'reset-allowance' ? 0n : request.grossBurnBaseUnits);
    // Simulate only the action possible in the state that actually exists now.
    const result = cctpBytesSchema.parse(await source.simulate(config.payment.sourceSender, to, data, src.number));
    if (purpose === 'standard-burn' ? result !== '0x' : result !== `0x${'0'.repeat(63)}1`) throw new Error('Source call simulation returned an incompatible result.');
    const gasEstimate = uint.positive().parse(await source.estimate(config.payment.sourceSender, to, data, src.number));
    nextTransaction = { purpose, chainId: route.source.chainId, from: config.payment.sourceSender, to, nonce: currentNonce, data, value: '0', gasEstimate };
  }
  const sourceCheck = blockHeaderSchema.parse(await source.getBlock({ blockNumber: src.number }));
  const destinationCheck = blockHeaderSchema.parse(await destination.getBlock({ blockNumber: dst.number }));
  if (sourceCheck.number !== src.number || sourceCheck.hash !== src.hash || sourceCheck.timestamp !== src.timestamp ||
    destinationCheck.number !== dst.number || destinationCheck.hash !== dst.hash || destinationCheck.timestamp !== dst.timestamp) throw new FinalityConflictError('First-payment snapshot changed.');
  for (const proof of accepted.evidence) if (await receiptFinality(destination, proof) !== 'finalized') throw new FinalityConflictError('Deployment provenance changed while preparing first payment.');
  if (nonce.parse(await source.getNonce(config.payment.sourceSender, 'pending')) !== pendingNonce) throw new Error('Source pending nonce changed during preparation.');
  return { ...base, status: blockers.length ? 'blocked' as const : nextTransaction?.purpose === 'standard-burn' ? 'burn-prepared' as const : 'approval-required' as const,
    blockers, nextTransaction, snapshots, funding, fee, intent, customerDelaySeconds: request.grossBurnBaseUnits > config.payment.policy.delayAbove ? config.payment.policy.delaySeconds : 0n,
    recoveryDelaySeconds: config.payment.recoveryDelay,
    requirements: ['This is one unsigned step, not authorization to publish. Recheck nonce/state/simulation and full fees immediately before signing.',
      'After a recorded successful approval/reset, rerun with the same intent/reserved burn nonce. No dependent burn is simulated or emitted before its allowance exists.',
      'Gas estimate is not a fee quote; obtain complete Base fees, including L1 data costs, before signing.',
      'The net credit is the actual attested burn minus executed fee, not a promised exact recipient amount. Record real burn/mint receipts before any payout review.',
      'Keep one active intent; do not initiate a second burn while awaiting mint. Do not change the operation ID or reserved nonce to conceal prior submission.',
      'Payout still requires the operator\'s real source/settlement and behavioral inputs. This preparation does not clear missing baseline/pricing/screening.',
    ],
  };
}
