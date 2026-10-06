// Synthetic deployment RPC facts only; never public receipt evidence.
import { vi } from 'vitest';
import { toHex, type Hex } from 'viem';
import { actors } from '../../../../src/tripwire/guardianVM.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../../src/chains/evm/registry/cctp.js';
import { initialPaymentPolicyHash } from '../../../../src/chains/evm/paymentPolicy.js';
import { cctpDeploymentPlan, cctpPaymentDeploymentSchema } from '../../testnet/cctpDeployPlan.js';
import { cctpBindings } from '../../testnet/cctpBindings.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from '../../testnet/artifactAcceptance.js';
import { acceptCctpDeployment, deploymentReceiptTemplate, type DeploymentAcceptanceReader } from '../../testnet/cctpDeploymentAcceptance.js';

export const input = { version: 3, deployer: actors.bridge.address, owner: actors.owner.address, oracle: actors.oracle.address,
  deployerNonce: '71', capBaseUnits: '100000000', windowSeconds: '3600',
  payment: { authority: actors.owner.address, sourceSender: actors.owner.address, returnRecipient: actors.owner.address, recoveryDelay: '3600',
    policy: { maxPayment: '10000000', manualApprovalAbove: '5000000', delayAbove: '5000000', delaySeconds: '1800' }, recipients: [actors.bridge.address] } };
export const hash = (n: bigint | number) => toHex(n, { size: 32 });
export function fixture(configInput = input) {
  const config = cctpPaymentDeploymentSchema.parse(configInput), plan = cctpDeploymentPlan(configInput);
  const { authority, sourceSender, returnRecipient, recoveryDelay } = config.payment;
  const bindings = { authority, sourceSender, returnRecipient, recoveryDelay };
  const bundle = deploymentReceiptTemplate(configInput); bundle.transactions = [hash(1), hash(2), hash(3), hash(4)];
  const header = (number: bigint) => ({ number, hash: hash(number), parentHash: hash(number - 1n), timestamp: 1_780_000_000n + number });
  let head = 200n;
  const transactions: Record<string, unknown>[] = plan.transactions.map((tx, i) => ({
    hash: bundle.transactions[i], from: tx.from, to: 'to' in tx ? tx.to : null, chainId: route.destination.chainId,
    nonce: i < 2 ? 71 + i : i, value: 0n, input: tx.data, blockNumber: 100n + BigInt(i), blockHash: hash(100 + i), transactionIndex: 0,
  }));
  const receipts: Record<string, unknown>[] = transactions.map((tx, i) => ({ transactionHash: tx.hash, from: tx.from, to: tx.to,
    status: 'success', blockNumber: tx.blockNumber, blockHash: tx.blockHash, transactionIndex: tx.transactionIndex,
    contractAddress: i === 0 ? plan.contracts.guardian : i === 1 ? plan.contracts.vault : null, gasUsed: 100_000n }));
  const facts: Record<string, unknown> = { ...cctpBindings(plan.contracts.vault), token: route.destination.usdc, guardian: plan.contracts.guardian,
    routeId: plan.routeId, REVIEW_FORMAT_VERSION: 3n, PAYMENT_ESCROW_VERSION: 1n, RELEASE_POLICY_VERSION: 2n,
    policyAuthority: authority, authorizedSourceSender: sourceSender, recoveryRecipient: returnRecipient, recoveryDelay,
    policyHash: initialPaymentPolicyHash(route.destination.chainId, plan.contracts.vault, plan.routeId, route.destination.usdc, plan.contracts.guardian, config.payment),
    paymentPolicy: [config.payment.policy.maxPayment, config.payment.policy.manualApprovalAbove, config.payment.policy.delayAbove, config.payment.policy.delaySeconds], policyVersion: 1n, queuedChange: hash(0), queuedChangeAt: 0n,
    totalCredited: 0n, totalPaid: 0n, totalReturned: 0n, MAX_REVIEW_TTL: 600n, POLICY_CHANGE_DELAY: 86400n, paymentsPaused: false, permittedRecipients: true, usedOperations: false,
  };
  const guardian: Record<string, unknown> = { owner: config.owner, oracle: config.oracle, GUARDIAN_POLICY_VERSION: 2n, isProtected: true,
    getRoute: { cap: config.capBaseUnits, windowSeconds: config.windowSeconds, outflowInWindow: 0n, tier: 0, pausedUntil: 0n, tierExpiresAt: 0n, delayUntil: 0n } };
  const grants = [{ address: plan.contracts.guardian, blockNumber: 103n, blockHash: hash(103), transactionHash: hash(4), logIndex: 0, removed: false,
    args: { caller: plan.contracts.vault, routeId: plan.routeId, allowed: true } }];
  const reader = { getChainId: vi.fn(async () => route.destination.chainId as number),
    getBlock: vi.fn(async (args: Parameters<DeploymentAcceptanceReader['getBlock']>[0]): Promise<unknown> => header('blockNumber' in args ? args.blockNumber : head)),
    getTransaction: vi.fn(async (h: Hex): Promise<unknown | null> => transactions[bundle.transactions.indexOf(h)] ?? null),
    getReceipt: vi.fn(async (h: Hex): Promise<unknown | null> => receipts[bundle.transactions.indexOf(h)] ?? null),
    readCode: vi.fn(async (address: Hex, _block: bigint): Promise<unknown> => address === plan.contracts.guardian ? expectedGuardianRuntime(address)
      : expectedPaymentRuntime(plan.contracts.vault, plan.contracts.guardian, bindings)),
    readVault: vi.fn(async (name: string, _block: bigint, _args?: readonly Hex[]) => facts[name]),
    readGuardian: vi.fn(async (name: string, _block: bigint, _args?: readonly Hex[]) => guardian[name]),
    readGuardianGrants: vi.fn(async (from: bigint, to: bigint): Promise<unknown> => grants.filter((g) => g.blockNumber >= from && g.blockNumber <= to)),
  } satisfies DeploymentAcceptanceReader;
  return { input: configInput, header, plan, bundle, reader, transactions, receipts, facts, guardian, grants, run: () => acceptCctpDeployment(configInput, bundle, reader), setHead: (n: bigint) => { head = n; } };
}
