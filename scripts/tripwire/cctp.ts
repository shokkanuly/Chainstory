// Read-only source authentication for Tripwire USDC escrow (ADR-017/018).
import { decodeEventLog, keccak256, stringToHex, zeroAddress, type Abi, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema, cctpAddressWord, cctpAttestedMessage, cctpBytesSchema, cctpEscrowReleaseId, cctpHookBeneficiary, cctpPaymentReleaseId, cctpReleaseId, decodeCctpPaymentHook, decodeCctpBurnBody, decodeCctpMessage } from '../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, CCTP_STANDARD_FINALITY, cctpEscrowAbi, cctpPaymentAbi, cctpMessengerAbi, cctpTransmitterAbi } from '../../src/chains/evm/registry/cctp.js';
import { eventOriginSchema, releaseEventSchema, type EventOrigin, type ReleaseEvent } from './events.js';
import { blockHashSchema, FinalityConflictError, receiptFinality, type BlockReader } from './finality.js';
import type { OperatorStore } from './store.js';
import { sourceVerifierScopeSchema } from './sourceProof.js';
import type { SourceAdapter, SourceEvidence } from './watch.js';
import { CctpAuditFailure, journalOperation, RpcBehindError } from './auditFailure.js';

export const cctpProofLocatorSchema = z.object({
  sourceTransactionHash: blockHashSchema, sourceLogIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  destinationTransactionHash: blockHashSchema.optional(),
}).strict();
export type CctpProofLocator = z.infer<typeof cctpProofLocatorSchema>;
export interface CctpRpc extends BlockReader {
  getChainId(): Promise<unknown>;
  getTransactionReceipt(args: { hash: Hex }): Promise<unknown | null>;
}
const uint32 = z.number().int().nonnegative().max(0xffffffff);
const logSchema = z.object({
  address: cctpAddressSchema, blockNumber: z.bigint().nonnegative(), blockHash: blockHashSchema,
  transactionHash: blockHashSchema, logIndex: z.number().int().nonnegative(), removed: z.literal(false),
  topics: z.array(blockHashSchema).max(4), data: cctpBytesSchema,
});
const receiptSchema = z.object({
  transactionHash: blockHashSchema, blockNumber: z.bigint().nonnegative(), blockHash: blockHashSchema,
  status: z.enum(['success', 'reverted']), logs: z.array(logSchema),
});
type Receipt = z.infer<typeof receiptSchema>;
type Log = z.infer<typeof logSchema>;
const receiveSchema = z.object({ caller: cctpAddressSchema, sourceDomain: uint32, nonce: blockHashSchema,
  sender: blockHashSchema, finalityThresholdExecuted: uint32, messageBody: cctpBytesSchema });
const mintSchema = z.object({ mintRecipient: cctpAddressSchema, amount: z.bigint().positive(), mintToken: cctpAddressSchema, feeCollected: z.bigint().nonnegative() });
const depositSchema = z.object({ burnToken: cctpAddressSchema, amount: z.bigint().positive(), depositor: cctpAddressSchema,
  mintRecipient: blockHashSchema, destinationDomain: uint32, destinationTokenMessenger: blockHashSchema,
  destinationCaller: blockHashSchema, maxFee: z.bigint().nonnegative(), minFinalityThreshold: uint32, hookData: cctpBytesSchema });

export const cctpPaymentBindingsSchema = z.object({
  authority: cctpAddressSchema.refine((a) => a !== zeroAddress),
  sourceSender: cctpAddressSchema.refine((a) => a !== zeroAddress),
  returnRecipient: cctpAddressSchema.refine((a) => a !== zeroAddress),
  recoveryDelay: z.union([z.bigint(), z.string().regex(/^[1-9][0-9]*$/).transform(BigInt)])
    .pipe(z.bigint().min(3600n).max(30n * 86400n)),
}).strict();
export type CctpPaymentBindings = z.output<typeof cctpPaymentBindingsSchema>;
/** 'screened-payment': the screened customer escrow (ADR-047/048), its own v2 hook and credit namespace. */
export type CctpPolicy = 'legacy-post-mint' | 'authenticated-escrow' | 'customer-payment' | 'screened-payment';
const paymentVersion = (policy: CctpPolicy) => policy === 'screened-payment' ? 2 : policy === 'customer-payment' ? 1 : undefined;
export function cctpVerifierScope(vault: string, policy: CctpPolicy = 'authenticated-escrow', payment?: CctpPaymentBindings) {
  const version = paymentVersion(policy);
  const bindings = version ? cctpPaymentBindingsSchema.parse(payment) : undefined;
  return sourceVerifierScopeSchema.parse({ kind: 'cctp-v2-usdc', settlement: route.destination.transmitter,
    ...(bindings ? { profile: version === 2 ? 'customer-payment-screened-v1' : 'customer-payment-v1' } : {}),
    fingerprint: keccak256(stringToHex(JSON.stringify({ policy: policy === 'legacy-post-mint' ? 'cctp-v2-usdc-post-mint-v1' : policy === 'customer-payment' ? 'cctp-v2-usdc-customer-payment-v1'
      : policy === 'screened-payment' ? 'cctp-v2-usdc-screened-payment-v1' : 'cctp-v2-usdc-authenticated-escrow-v1', route, vault: cctpAddressSchema.parse(vault),
      finality: 'both-rpc-finalized-and-circle-standard', hook: version ? `Tripwire/CCTP/v2/USDC/payment/v${version}` : 'Tripwire/CCTP/v2/USDC/beneficiary/v1',
      ...(bindings ? { payment: { ...bindings, recoveryDelay: bindings.recoveryDelay.toString() } } : {}) }))) });
}
const origin = (chainId: number, log: Log): EventOrigin => eventOriginSchema.parse({ chainId, ...log });
const decoded = (receipt: Receipt, address: Hex, abi: Abi, eventName: string) => receipt.logs.flatMap((log) => {
  if (log.address !== address) return [];
  // Unknown events are irrelevant; malformed known events make evidence unavailable.
  const events = abi.filter((item) => item.type === 'event' && item.name === eventName);
  const event = events[0];
  if (!event || event.type !== 'event') throw new Error('Missing registered CCTP event.');
  const signature = `${event.name}(${event.inputs.map((i) => i.type).join(',')})`;
  if (log.topics[0] !== keccak256(stringToHex(signature))) return [];
  const value = decodeEventLog({ abi, eventName, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
  return [{ log, args: value.args }];
});
const unavailable = (reason: string): SourceEvidence => ({ status: 'unavailable', reason });
const invalid = (reason: string): SourceEvidence => ({ status: 'invalid', reason });
const pending = (reason: string): SourceEvidence => ({ status: 'pending', reason });

export class CctpSourceAdapter implements SourceAdapter {
  readonly scope;
  private readonly vault: Hex;
  private readonly payment?: CctpPaymentBindings;
  private readonly paymentVersion?: 1 | 2;
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private store: OperatorStore, vault: string, private sourceRpc: CctpRpc, private destinationRpc: CctpRpc,
    private locate: (messageId: Hex) => Promise<unknown | null>, private readonly policy: CctpPolicy = 'authenticated-escrow', payment?: CctpPaymentBindings) {
    this.paymentVersion = paymentVersion(policy);
    this.payment = this.paymentVersion ? cctpPaymentBindingsSchema.parse(payment) : undefined;
    this.vault = cctpAddressSchema.parse(vault); this.scope = cctpVerifierScope(this.vault, policy, this.payment);
    if (store.scope.sourceChainId !== route.source.chainId || store.scope.chainId !== route.destination.chainId ||
      store.scope.source !== route.source.transmitter || store.scope.vault !== this.vault || store.scope.token !== route.destination.usdc ||
      store.scope.decimals !== route.decimals || store.scope.finalityMode !== 'finalized' ||
      JSON.stringify(store.scope.sourceVerifier) !== JSON.stringify(this.scope)) throw new Error('CCTP adapter deployment scope does not match.');
  }

  verify(release: ReleaseEvent): Promise<SourceEvidence> {
    const run = this.lock.then(() => this.check(release)); this.lock = run.catch(() => undefined); return run;
  }

  async assertCanonical(): Promise<void> {
    const quarantine = journalOperation(() => this.store.sourceQuarantine());
    if (quarantine) throw new FinalityConflictError(`CCTP source quarantine: ${quarantine}`);
    const [source, destination] = await Promise.all([this.sourceRpc.getChainId(), this.destinationRpc.getChainId()]);
    const chainId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
    if (chainId.parse(source) !== route.source.chainId || chainId.parse(destination) !== route.destination.chainId) throw new Error('CCTP RPC chain identity does not match the supported route.');
    for (const proof of journalOperation(() => this.store.sourceProofs())) {
      for (const [rpc, anchor] of [[this.sourceRpc, proof.source], [this.destinationRpc, proof.destination]] as const) {
        const result = await receiptFinality(rpc, anchor);
        if (result === 'orphaned') {
          const reason = 'An authenticated finalized CCTP proof block changed; reconcile the operator.';
          journalOperation(() => this.store.quarantineSource(reason)); throw new FinalityConflictError(reason);
        }
        if (result !== 'finalized') throw new RpcBehindError('CCTP finalized RPC is behind an authenticated proof.');
      }
    }
  }

  private async readReceipt(rpc: CctpRpc, hash: Hex): Promise<Receipt | null> {
    const raw = await rpc.getTransactionReceipt({ hash }); if (raw === null) return null;
    const receipt = receiptSchema.parse(raw);
    if (receipt.transactionHash !== hash) throw new Error('RPC returned the wrong CCTP receipt.');
    const positions = new Set<number>();
    for (const log of receipt.logs) {
      if (log.transactionHash !== hash || log.blockHash !== receipt.blockHash || log.blockNumber !== receipt.blockNumber || positions.has(log.logIndex)) {
        throw new Error('CCTP receipt log provenance is inconsistent.');
      }
      positions.add(log.logIndex);
    }
    return receipt;
  }

  private async check(input: ReleaseEvent): Promise<SourceEvidence> {
    try {
      const release = releaseEventSchema.parse(input);
      await this.assertCanonical(); // A committed finalized conflict must escape into quarantine.
      if (release.origin && (release.origin.chainId !== route.destination.chainId || release.origin.address !== this.vault)) {
        return invalid('Release originated on the wrong chain or vault.');
      }
      const cached = journalOperation(() => this.store.sourceProofs()).find((p) => p.messageId === release.messageId);
      if (cached && !this.payment && (this.policy === 'legacy-post-mint' || !release.origin)) return cached.recipient === release.recipient && cached.amount === release.amount
        ? { status: 'verified', amount: cached.amount } : invalid('Release fields differ from its authenticated source proof.');
      const rawLocator = await this.locate(release.messageId);
      if (rawLocator === null) return pending('Source transaction locator is not available.');
      const locator = cctpProofLocatorSchema.parse(rawLocator);
      if (this.policy === 'legacy-post-mint' && cctpReleaseId(route.source.chainId, route.source.transmitter, locator.sourceTransactionHash, locator.sourceLogIndex) !== release.messageId) {
        return invalid('Release ID is not bound to this CCTP source event.');
      }
      const sentReceipt = await this.readReceipt(this.sourceRpc, locator.sourceTransactionHash);
      if (!sentReceipt) return pending('Source receipt is not available.');
      if (await receiptFinality(this.sourceRpc, sentReceipt) !== 'finalized') return pending('Source receipt is not canonical and finalized.');
      if (sentReceipt.status !== 'success') return invalid('Source transaction reverted; no authenticated burn.');
      const sent = decoded(sentReceipt, route.source.transmitter, cctpTransmitterAbi, 'MessageSent');
      const selected = sent.find((item) => item.log.logIndex === locator.sourceLogIndex);
      if (!selected) return invalid('The source log is not MessageSent from the configured CCTP transmitter.');
      const message = decodeCctpMessage(z.object({ message: cctpBytesSchema }).parse(selected.args).message);
      const body = message.body;
      if (message.sourceDomain !== route.source.domain || message.destinationDomain !== route.destination.domain ||
        message.sender !== route.source.messenger || message.recipient !== route.destination.messenger || body.burnToken !== route.source.usdc || body.mintRecipient !== this.vault) {
        return invalid('CCTP chain, messenger, token or escrow recipient does not match the configured route.');
      }
      if (message.minFinalityThreshold !== CCTP_STANDARD_FINALITY) return unavailable('Only Circle Standard Transfer is supported.');
      if (this.policy !== 'legacy-post-mint' && message.destinationCaller !== this.vault) return invalid('Authenticated escrow must be the exclusive CCTP destination caller.');
      if (!/^0x0{64}$/.test(message.nonce) || message.finalityThresholdExecuted !== 0 || body.feeExecuted !== 0n || body.expirationBlock !== 0n || body.amount <= 0n || body.maxFee >= body.amount) {
        return invalid('Source MessageSent contains invalid burn or relay fields.');
      }
      const paymentIntent = this.payment ? decodeCctpPaymentHook(body.hookData, this.paymentVersion) : undefined;
      if ((paymentIntent?.recipient ?? cctpHookBeneficiary(body.hookData)) !== release.recipient) return invalid('Release recipient differs from the authenticated beneficiary hook.');
      if (paymentIntent && (paymentIntent.returnRecipient !== this.payment?.returnRecipient || body.messageSender !== this.payment?.sourceSender)) {
        return invalid('Payment source sender or fixed return recipient differs from customer bindings.');
      }
      const deposits = decoded(sentReceipt, route.source.messenger, cctpMessengerAbi, 'DepositForBurn');
      if (sent.length !== 1 || deposits.length !== 1) return unavailable('Batched source transfers require an explicit pairing adapter.');
      const deposit = depositSchema.parse(deposits[0].args);
      if (deposits[0].log.logIndex <= selected.log.logIndex || deposit.burnToken !== body.burnToken || deposit.amount !== body.amount ||
        deposit.depositor !== body.messageSender || deposit.mintRecipient !== cctpAddressWord(this.vault) ||
        deposit.destinationDomain !== message.destinationDomain || deposit.destinationTokenMessenger !== cctpAddressWord(message.recipient) ||
        deposit.destinationCaller !== cctpAddressWord(message.destinationCaller) || deposit.maxFee !== body.maxFee ||
        deposit.minFinalityThreshold !== message.minFinalityThreshold || deposit.hookData !== body.hookData) return invalid('DepositForBurn does not match the source message.');
      if (!locator.destinationTransactionHash) return pending('USDC has not been proven minted into this vault.');
      const mintedReceipt = await this.readReceipt(this.destinationRpc, locator.destinationTransactionHash);
      if (!mintedReceipt || mintedReceipt.status !== 'success') return pending('Destination mint receipt is unavailable or reverted.');
      if (await receiptFinality(this.destinationRpc, mintedReceipt) !== 'finalized') return pending('Destination mint is not canonical and finalized.');
      const receives = decoded(mintedReceipt, route.destination.transmitter, cctpTransmitterAbi, 'MessageReceived');
      const mints = decoded(mintedReceipt, route.destination.messenger, cctpMessengerAbi, 'MintAndWithdraw');
      if (receives.length !== 1 || mints.length !== 1) return unavailable('A single authenticated CCTP receive and mint must be paired.');
      const receive = receiveSchema.parse(receives[0].args); const mint = mintSchema.parse(mints[0].args);
      const receivedBody = decodeCctpBurnBody(receive.messageBody);
      if (receive.finalityThresholdExecuted !== CCTP_STANDARD_FINALITY) return unavailable('Destination receive is not a supported Standard Transfer.');
      if (receive.sourceDomain !== message.sourceDomain || receive.sender !== cctpAddressWord(message.sender) || /^0x0{64}$/.test(receive.nonce) ||
        (message.destinationCaller !== zeroAddress && receive.caller !== message.destinationCaller)) return invalid('CCTP received message domain, sender, caller or nonce is invalid.');
      for (const field of ['burnToken', 'mintRecipient', 'amount', 'messageSender', 'maxFee', 'hookData'] as const) {
        if (body[field] !== receivedBody[field]) return invalid('CCTP received message differs from its authenticated burn.');
      }
      if (receivedBody.feeExecuted > body.maxFee || receivedBody.feeExecuted >= body.amount ||
        (receivedBody.expirationBlock !== 0n && receivedBody.expirationBlock <= mintedReceipt.blockNumber)) return invalid('CCTP fee or expiration is invalid at mint time.');
      const net = body.amount - receivedBody.feeExecuted;
      if (mint.mintRecipient !== this.vault || mint.mintToken !== route.destination.usdc || mint.amount !== net || mint.feeCollected !== receivedBody.feeExecuted ||
        mints[0].log.logIndex >= receives[0].log.logIndex) return invalid('USDC mint does not match this burn, fee and vault.');
      if (release.amount !== net) return invalid('Release amount differs from the exact net USDC minted into escrow.');
      if (this.policy !== 'legacy-post-mint') {
        const releaseId = paymentIntent ? cctpPaymentReleaseId(route.destination.chainId, this.vault, message.sourceDomain, receive.nonce, this.paymentVersion)
          : cctpEscrowReleaseId(route.destination.chainId, this.vault, message.sourceDomain, receive.nonce);
        if (releaseId !== release.messageId) {
          return invalid('Release ID is not bound to this escrow and authenticated CCTP nonce.');
        }
        const requested = decoded(mintedReceipt, this.vault, cctpEscrowAbi, 'ReleaseRequested');
        const funded = decoded(mintedReceipt, this.vault, cctpEscrowAbi, 'CctpEscrowFunded');
        if (requested.length !== 1 || funded.length !== 1) return unavailable('Mint receipt must contain exactly one authenticated escrow credit.');
        const request = z.object({ messageId: blockHashSchema, to: cctpAddressSchema, amount: z.bigint().positive() }).parse(requested[0].args);
        const credit = z.object({ messageId: blockHashSchema, nonce: blockHashSchema, messageHash: blockHashSchema, amount: z.bigint().positive() }).parse(funded[0].args);
        if (request.messageId !== release.messageId || request.to !== release.recipient || request.amount !== net ||
          credit.messageId !== release.messageId || credit.nonce !== receive.nonce || credit.amount !== net ||
          credit.messageHash !== keccak256(cctpAttestedMessage(message.raw, receive.nonce, receive.finalityThresholdExecuted, receivedBody.raw)) ||
          requested[0].log.logIndex <= receives[0].log.logIndex || funded[0].log.logIndex <= requested[0].log.logIndex) {
          return invalid('Escrow credit differs from its authenticated mint or event ordering.');
        }
        const expectedOrigin = origin(route.destination.chainId, requested[0].log);
        if (release.origin && (['chainId', 'address', 'blockNumber', 'blockHash', 'transactionHash', 'logIndex'] as const)
          .some((field) => release.origin?.[field] !== expectedOrigin[field])) {
          return invalid('Release request provenance differs from the atomic mint transaction.');
        }
        if (paymentIntent) {
          const bound = decoded(mintedReceipt, this.vault, cctpPaymentAbi, 'PaymentCreditBound');
          if (bound.length !== 1) return unavailable('Mint must contain exactly one customer payment binding.');
          const b = z.object({ messageId: blockHashSchema, operationId: blockHashSchema,
            returnRecipient: cctpAddressSchema, intentPolicyHash: blockHashSchema }).parse(bound[0].args);
          if (b.messageId !== release.messageId || b.operationId !== paymentIntent.operationId ||
            b.returnRecipient !== paymentIntent.returnRecipient || b.intentPolicyHash !== paymentIntent.policyHash ||
            bound[0].log.logIndex <= receives[0].log.logIndex || bound[0].log.logIndex >= requested[0].log.logIndex) {
            return invalid('Customer operation, return recipient or policy binding differs from the atomic mint.');
          }
        }
      }
      // Revalidate after all RPC queries, then commit claims before returning VERIFIED.
      await this.assertCanonical();
      if (await receiptFinality(this.sourceRpc, sentReceipt) !== 'finalized' || await receiptFinality(this.destinationRpc, mintedReceipt) !== 'finalized') {
        return pending('CCTP receipt changed while evidence was being collected.');
      }
      const proof = { messageId: release.messageId, recipient: release.recipient, amount: net, nonce: receive.nonce,
        source: origin(route.source.chainId, selected.log), destination: origin(route.destination.chainId, receives[0].log),
        sourceMessageHash: keccak256(message.raw), destinationBodyHash: keccak256(receivedBody.raw),
        ...(paymentIntent ? { payment: paymentIntent } : {}) };
      const saved = journalOperation(() => this.store.saveSourceProof(proof));
      return saved === 'reused' ? invalid('This source event, destination settlement or CCTP nonce is already claimed by another release.')
        : { status: 'verified', amount: net };
    } catch (error) {
      if (error instanceof FinalityConflictError || (error instanceof CctpAuditFailure && error.reason === 'journal')) throw error;
      return unavailable('CCTP evidence is unavailable, malformed or unsupported; retry or reconcile the inputs.');
    }
  }
}
