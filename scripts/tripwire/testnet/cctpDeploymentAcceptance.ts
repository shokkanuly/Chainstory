// Receipt-backed, keyless acceptance of a fresh, unused product deployment.
import { keccak256, stringToHex, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { initialPaymentPolicyHash, initialScreenedPolicyHash } from '../../../src/chains/evm/paymentPolicy.js';
import { blockHashSchema, blockHeaderSchema, FinalityConflictError, receiptFinality } from '../finality.js';
import { cctpCustomerDeploymentSchema, cctpDeploymentPlan } from './cctpDeployPlan.js';
import { stringifyPublic } from './cctpPreflight.js';
import { assertPaymentRuntime } from './artifactAcceptance.js';
import { assertCctpPaymentBindings } from './cctpBindings.js';
import { assertProtectionPolicy } from './protectionPolicy.js';

const uint = z.bigint().nonnegative().max((1n << 256n) - 1n);
const index = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const inputCode = z.string().regex(/^0x([0-9a-fA-F]{2})*$/).max(2 + 49152 * 2).transform((s) => s.toLowerCase() as Hex);
const transactionSchema = z.object({ hash: blockHashSchema, from: cctpAddressSchema, to: cctpAddressSchema.nullable(),
  chainId: z.number().int().positive(), nonce: index, value: uint, input: inputCode,
  blockNumber: uint.nullable(), blockHash: blockHashSchema.nullable(), transactionIndex: index.nullable(),
});
const receiptSchema = z.object({ transactionHash: blockHashSchema, from: cctpAddressSchema, to: cctpAddressSchema.nullable(),
  status: z.enum(['success', 'reverted']), contractAddress: cctpAddressSchema.nullable(),
  blockNumber: uint, blockHash: blockHashSchema, transactionIndex: index, gasUsed: uint.refine((n) => n > 0n),
});
export const deploymentReceiptBundleSchema = z.object({ version: z.literal(1), packageHash: blockHashSchema,
  transactions: z.tuple([blockHashSchema.nullable(), blockHashSchema.nullable(), blockHashSchema.nullable(), blockHashSchema.nullable()]),
}).strict().refine((b) => { const hashes = b.transactions.filter((h) => h !== null); return new Set(hashes).size === hashes.length; }, 'Duplicate deployment transaction hash.');
export interface DeploymentAcceptanceReader {
  getChainId(): Promise<unknown>;
  getBlock(args: { blockTag: 'finalized' } | { blockNumber: bigint }): Promise<unknown>;
  getTransaction(hash: Hex): Promise<unknown | null>;
  getReceipt(hash: Hex): Promise<unknown | null>;
  readCode(address: Hex, blockNumber: bigint): Promise<unknown>;
  readVault(name: string, blockNumber: bigint, args?: readonly Hex[]): Promise<unknown>;
  readGuardian(name: string, blockNumber: bigint, args?: readonly Hex[]): Promise<unknown>;
  readGuardianGrants(fromBlock: bigint, toBlock: bigint): Promise<unknown>;
}
export function deploymentReceiptTemplate(input: unknown) {
  cctpCustomerDeploymentSchema.parse(input);
  const plan = cctpDeploymentPlan(input);
  return deploymentReceiptBundleSchema.parse({ version: 1, packageHash: keccak256(stringToHex(stringifyPublic(plan))), transactions: [null, null, null, null] });
}

export async function acceptCctpDeployment(input: unknown, receiptInput: unknown, reader: DeploymentAcceptanceReader) {
  const config = cctpCustomerDeploymentSchema.parse(input), plan = cctpDeploymentPlan(input);
  const bundle = deploymentReceiptBundleSchema.parse(receiptInput);
  const packageHash = deploymentReceiptTemplate(input).packageHash;
  if (bundle.packageHash !== packageHash) throw new Error('Deployment receipt bundle does not match the current unsigned package.');
  if (z.number().int().parse(await reader.getChainId()) !== route.destination.chainId) throw new Error('Deployment acceptance RPC is not Ethereum Sepolia.');
  const head = blockHeaderSchema.parse(await reader.getBlock({ blockTag: 'finalized' }));
  const base = { version: 1, mode: 'keyless-initial-deployment-acceptance', enforcement: false,
    chainId: route.destination.chainId, route: route.id, packageHash, finalized: head, contracts: plan.contracts,
    artifactHashes: plan.artifactHashes, manifest: plan.manifest };
  const evidence: { step: number; transactionHash: Hex; blockNumber: bigint; blockHash: Hex; transactionIndex: number; inputHash: Hex; gasUsed: bigint }[] = [];
  const blockers: string[] = [];
  for (let i = 0; i < 4; i++) {
    const hash = bundle.transactions[i], expected = plan.transactions[i];
    if (hash === null) { blockers.push(`STEP_${i + 1}_TRANSACTION_NOT_RECORDED`); continue; }
    const [rawTx, rawReceipt] = await Promise.all([reader.getTransaction(hash), reader.getReceipt(hash)]);
    if (rawTx === null || rawReceipt === null) { blockers.push(`STEP_${i + 1}_TRANSACTION_OR_RECEIPT_UNAVAILABLE`); continue; }
    const tx = transactionSchema.parse(rawTx), receipt = receiptSchema.parse(rawReceipt);
    const to = 'to' in expected ? expected.to ?? null : null;
    if (tx.hash !== hash || receipt.transactionHash !== hash || tx.chainId !== route.destination.chainId ||
      tx.from !== expected.from || receipt.from !== expected.from || tx.to !== to || receipt.to !== to ||
      tx.input !== expected.data.toLowerCase() || tx.value !== 0n || ('nonce' in expected && expected.nonce !== undefined && BigInt(tx.nonce) !== expected.nonce)) {
      throw new Error(`Step ${i + 1} transaction does not match the reviewed unsigned package.`);
    }
    if (receipt.status !== 'success') throw new Error(`Step ${i + 1} deployment/configuration transaction reverted.`);
    const contractAddress = i === 0 ? plan.contracts.guardian : i === 1 ? plan.contracts.vault : null;
    if (receipt.contractAddress !== contractAddress) throw new Error(`Step ${i + 1} created an unexpected contract address.`);
    if (tx.blockNumber !== receipt.blockNumber || tx.blockHash !== receipt.blockHash || tx.transactionIndex !== receipt.transactionIndex) {
      throw new Error(`Step ${i + 1} transaction and receipt inclusion disagree.`);
    }
    if (receipt.blockNumber > head.number) { blockers.push(`STEP_${i + 1}_WAIT_FINALITY`); continue; }
    const finality = await receiptFinality(reader, receipt);
    if (finality === 'orphaned') throw new FinalityConflictError(`Step ${i + 1} deployment receipt is not canonical.`);
    if (finality === 'pending') { blockers.push(`STEP_${i + 1}_WAIT_FINALITY`); continue; }
    evidence.push({ step: i + 1, transactionHash: hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
      transactionIndex: receipt.transactionIndex, inputHash: keccak256(tx.input), gasUsed: receipt.gasUsed });
  }
  const stable = async () => {
    const checked = blockHeaderSchema.parse(await reader.getBlock({ blockNumber: head.number }));
    if (checked.hash !== head.hash || checked.number !== head.number || checked.timestamp !== head.timestamp) throw new FinalityConflictError('Deployment acceptance state block changed.');
    const current = blockHeaderSchema.parse(await reader.getBlock({ blockTag: 'finalized' }));
    if (current.number < head.number) throw new Error('Finalized acceptance RPC moved behind the state snapshot.');
  };
  if (blockers.length) { await stable(); return { ...base, status: 'pending' as const, initialDeploymentAccepted: false as const, evidence, blockers }; }
  for (let i = 1; i < evidence.length; i++) {
    const previous = evidence[i - 1], next = evidence[i];
    if (previous.blockNumber > next.blockNumber || (previous.blockNumber === next.blockNumber && previous.transactionIndex >= next.transactionIndex)) {
      throw new Error('Deployment/configuration transactions were not executed in package order.');
    }
  }
  const { runtime, expectedPolicyHash, routeState, grants } = await readInitialDeploymentState(input, reader, head.number, evidence);
  // Receipt provenance prevents accepting arbitrary initcode that installs the same runtime
  // while inventing storage/mapping values. Version 1/hash checks detect later policy edits.
  for (const proof of evidence) {
    if (await receiptFinality(reader, proof) !== 'finalized') throw new FinalityConflictError('Deployment provenance changed during state acceptance.');
  }
  await stable();
  return { ...base, status: 'accepted' as const, initialDeploymentAccepted: true as const, evidence, blockers: [], runtime,
    destinationStartBlock: evidence[0].blockNumber, policy: { version: 1n, hash: expectedPolicyHash, ...config.payment }, routeBudget: routeState, grants,
    ...(plan.screening ? { screening: plan.screening } : {}),
    remainingGates: ['Acceptance covers this finalized initial deployment snapshot only; recheck live policy, roles, grants and guardian state before a burn.',
      'No source permission/control audit, Circle attestation, burn/mint/payment, operator input baseline or external security review is established by this report.',
      ...(plan.screening ? ['The screened escrow is paused in legacy mode with no list head. Unpausing needs the customer\'s queued action; a real screening provider and an independent review of advisory mode remain open.'] : [])],
  };
}

// Used only after transaction provenance acceptance; re-read at a newer live block
// before preparing the first source action. This does not authenticate receipts.
export async function readInitialDeploymentState(input: unknown, reader: DeploymentAcceptanceReader, blockNumber: bigint,
  evidence: readonly { blockNumber: bigint; blockHash: Hex; transactionHash: Hex }[]) {
  const config = cctpCustomerDeploymentSchema.parse(input), plan = cctpDeploymentPlan(input);
  const screened = config.version === 4 && plan.screening ? plan.screening : null;
  if (evidence.length !== 4 || evidence.some((e) => e.blockNumber > blockNumber)) throw new Error('Initial state read is behind deployment provenance.');
  const head = { number: blockNumber };
  const { authority, sourceSender, returnRecipient, recoveryDelay } = config.payment;
  const bindings = { authority, sourceSender, returnRecipient, recoveryDelay };
  const runtime = await assertPaymentRuntime(plan.contracts.vault, plan.contracts.guardian, bindings, head.number,
    (address, number) => reader.readCode(address, number), screened ? 'screened' : 'payment');
  await assertCctpPaymentBindings(plan.contracts.vault, bindings, (name) => reader.readVault(name, head.number), Boolean(screened));
  await assertProtectionPolicy({ guardianVersion: () => reader.readGuardian('GUARDIAN_POLICY_VERSION', head.number),
    releaseVersion: () => reader.readVault('RELEASE_POLICY_VERSION', head.number), reviewFormat: () => reader.readVault('REVIEW_FORMAT_VERSION', head.number),
    routePermission: () => reader.readGuardian('isProtected', head.number, [plan.contracts.vault, plan.routeId]),
  }, screened ? 4 : 3);
  for (const [name, expected] of [['owner', config.owner], ['oracle', config.oracle]] as const) {
    if (cctpAddressSchema.parse(await reader.readGuardian(name, head.number)) !== expected) throw new Error(`Guardian ${name} changed from the deployment package.`);
  }
  for (const [name, expected] of [['token', route.destination.usdc], ['guardian', plan.contracts.guardian], ['routeId', plan.routeId]] as const) {
    const actual = name === 'routeId' ? blockHashSchema.parse(await reader.readVault(name, head.number)) : cctpAddressSchema.parse(await reader.readVault(name, head.number));
    if (actual !== expected) throw new Error(`Payment escrow ${name} differs from deployment package.`);
  }
  const routeState = z.object({ cap: uint, windowSeconds: uint, outflowInWindow: uint, tier: z.number().int().min(0).max(3),
    pausedUntil: uint, tierExpiresAt: uint, delayUntil: uint,
  }).parse(await reader.readGuardian('getRoute', head.number, [plan.routeId]));
  if (routeState.cap !== config.capBaseUnits || routeState.windowSeconds !== config.windowSeconds || routeState.outflowInWindow !== 0n ||
    routeState.tier !== 0 || routeState.pausedUntil !== 0n || routeState.tierExpiresAt !== 0n || routeState.delayUntil !== 0n) {
    throw new Error('Guardian budget/protection is not the fresh configured package state.');
  }
  const expectedPolicyHash = screened ? initialScreenedPolicyHash(route.destination.chainId, plan.contracts.vault, plan.routeId,
    route.destination.usdc, plan.contracts.guardian, config.payment, screened.profileHash)
    : initialPaymentPolicyHash(route.destination.chainId, plan.contracts.vault, plan.routeId, route.destination.usdc, plan.contracts.guardian, config.payment);
  if (blockHashSchema.parse(await reader.readVault('policyHash', head.number)) !== expectedPolicyHash) throw new Error('Initial customer policy hash differs from the complete constructor package.');
  const { maxPayment, manualApprovalAbove, delayAbove, delaySeconds } = config.payment.policy;
  const expectedPolicy = [maxPayment, manualApprovalAbove, delayAbove, delaySeconds];
  const actualPolicy = z.tuple([uint, uint, uint, uint]).parse(await reader.readVault('paymentPolicy', head.number));
  if (actualPolicy.some((value, i) => value !== expectedPolicy[i])) throw new Error('Initial customer policy values differ from deployment package.');
  for (const [name, expected] of [['policyVersion', 1n], ['queuedChangeAt', 0n], ['totalCredited', 0n], ['totalPaid', 0n],
    ['totalReturned', 0n], ['MAX_REVIEW_TTL', 600n], ['POLICY_CHANGE_DELAY', 86400n]] as const) {
    if (uint.parse(await reader.readVault(name, head.number)) !== expected) throw new Error(`Fresh deployment ${name} changed or is incompatible.`);
  }
  // The screened escrow must start paused (ADR-047); the payment escrow must not.
  if (z.boolean().parse(await reader.readVault('paymentsPaused', head.number)) !== Boolean(screened)) {
    throw new Error(screened ? 'Fresh screened escrow is not paused.' : 'Fresh customer payments are paused.');
  }
  if (screened && config.version === 4) {
    if (z.union([z.number(), z.bigint()]).transform(Number).parse(await reader.readVault('executionMode', head.number)) !== 0) throw new Error('Fresh screened escrow is not in legacy mode.');
    if (blockHashSchema.parse(await reader.readVault('screeningProfileHash', head.number)) !== screened.profileHash) throw new Error('Screening profile hash differs from the deployment package.');
    const [providerIdHash, listIdHash, issuer, observation, snapshot] = z.tuple([blockHashSchema, blockHashSchema, cctpAddressSchema,
      z.union([z.number(), z.bigint()]).transform(BigInt), z.union([z.number(), z.bigint()]).transform(BigInt)]).parse(await reader.readVault('screeningProfile', head.number));
    const p = config.screening;
    if (providerIdHash !== p.providerIdHash || listIdHash !== p.listIdHash || issuer !== p.issuer || observation !== p.maxObservationAgeSeconds || snapshot !== p.maxSnapshotAgeSeconds) {
      throw new Error('Screening profile fields differ from the deployment package.');
    }
    const activeHead = z.tuple([blockHashSchema, uint, uint, uint]).parse(await reader.readVault('activeHead', head.number));
    if (activeHead[0] !== `0x${'00'.repeat(32)}` || activeHead.slice(1).some((v) => v !== 0n)) throw new Error('Fresh screened escrow already has a list head.');
  }
  if (blockHashSchema.parse(await reader.readVault('queuedChange', head.number)) !== `0x${'00'.repeat(32)}`) throw new Error('Fresh customer policy has a queued change.');
  for (const address of config.payment.recipients) {
    if (!z.boolean().parse(await reader.readVault('permittedRecipients', head.number, [address]))) throw new Error('A configured initial recipient is not permitted.');
  }
  // No getter enumerates this mapping. Reconstruct grants from the fresh guardian's
  // complete ProtectedSet history, rather than checking only one positive entry.
  if (head.number - evidence[0].blockNumber > 50_000n) throw new Error('Fresh deployment grant history exceeds the bounded acceptance range; reconcile it explicitly.');
  const grantSchema = z.object({ address: cctpAddressSchema, blockNumber: uint, blockHash: blockHashSchema,
    transactionHash: blockHashSchema, logIndex: index, removed: z.literal(false),
    args: z.object({ caller: cctpAddressSchema, routeId: blockHashSchema, allowed: z.boolean() }),
  });
  const grants: z.infer<typeof grantSchema>[] = [];
  for (let from = evidence[0].blockNumber; from <= head.number; from += 2_000n) {
    const to = from + 1_999n > head.number ? head.number : from + 1_999n;
    const logs = z.array(grantSchema).max(100).parse(await reader.readGuardianGrants(from, to));
    for (const log of logs) {
      if (log.address !== plan.contracts.guardian || log.blockNumber < from || log.blockNumber > to) throw new Error('Guardian grant log has invalid query provenance.');
      grants.push(log);
    }
  }
  const grant = grants[0], grantReceipt = evidence[3];
  if (grants.length !== 1 || !grant || grant.args.caller !== plan.contracts.vault || grant.args.routeId !== plan.routeId || !grant.args.allowed ||
    grant.transactionHash !== grantReceipt.transactionHash || grant.blockNumber !== grantReceipt.blockNumber || grant.blockHash !== grantReceipt.blockHash) {
    throw new Error('Fresh guardian grant history differs from the single approved escrow permission.');
  }
  return { runtime, expectedPolicyHash, routeState, grants };
}
