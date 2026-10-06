// Synthetic RPC boundary fixture. Real cryptographic transaction/review signatures,
// synthetic receipts/state; no public RPC, Circle attester or deployment is used.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, hashStruct, keccak256, parseTransaction, recoverTypedDataAddress, stringToHex, toHex, zeroAddress,
  type Chain, type Hex, type PublicClient, type Transport } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { PAYMENT_RELEASE_REVIEW_TYPES, RELEASE_REVIEW_TYPES } from '../review.js';
import { createCctpRpcOperator } from '../testnet/cctpOperator.js';
import { cctpBindings } from '../testnet/cctpBindings.js';
import type { Clients } from '../testnet/sepolia.js';
import paymentArtifact from '../testnet/cctpPaymentEscrow.artifact.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from '../testnet/artifactAcceptance.js';
import { paymentBindings, paymentFixture } from './fixtures/cctpPayment.js';
import { beneficiary, destinationTx, sender, vault } from './fixtures/cctp.js';

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });
function fixture() {
  const f = paymentFixture(), routeId = keccak256(stringToHex(route.id));
  const facts: Record<string, unknown> = { ...cctpBindings(vault), REVIEW_FORMAT_VERSION: 3n, PAYMENT_ESCROW_VERSION: 1n,
    policyAuthority: sender, recoveryRecipient: sender, authorizedSourceSender: sender, recoveryDelay: 3600n,
    token: route.destination.usdc, guardian: actors.oracle.address, routeId, MAX_REVIEW_TTL: 600n, RELEASE_POLICY_VERSION: 2n,
    releases: [beneficiary, f.release.amount, 0, 0n, zeroAddress, 0n, 0], credits: [sender, f.intent.operationId, f.intent.policyHash, 0n, false],
    policyVersion: 1n, policyHash: f.intent.policyHash, reviewedPolicyVersion: 0n, approvedPolicyVersion: 0n,
    paymentPolicy: [10_000_000n, 5_000_000n, 5_000_000n, 1800n], permittedRecipients: true, paymentsPaused: false, paymentDelayUntil: 0n, releaseDelayUntil: 0n };
  let latest = 200n, finalized = 200n, autoFinalize = true, transactionNonce = 0, crash: 'before' | 'after' | null = null;
  const hashes = [toHex(0, { size: 32 }), f.destinationReceipt.blockHash, toHex(33, { size: 32 })];
  const header = (number: bigint) => ({ number, hash: number === 199n ? hashes[0] : number === 200n ? hashes[1] : hashes[2],
    parentHash: number === 201n ? hashes[1] : hashes[0], timestamp: 1_780_000_000n });
  const receipts = new Map<Hex, { status: 'success'; blockNumber: bigint; blockHash: Hex; gasUsed: bigint; transactionHash: Hex }>();
  const published: Hex[] = [], reviews: { version: bigint; hash: Hex }[] = [];
  const pub = {
    getCode: vi.fn(async ({ address }: { address: Hex; blockNumber: bigint }) => address.toLowerCase() === actors.oracle.address.toLowerCase()
      ? expectedGuardianRuntime(actors.oracle.address) : expectedPaymentRuntime(vault, actors.oracle.address, paymentBindings)),
    getBlock: vi.fn(async (args?: { blockNumber?: bigint; blockTag?: string }) => header(args?.blockNumber ?? (args?.blockTag === 'finalized' ? finalized : latest))),
    getChainId: async () => route.destination.chainId,
    readContract: vi.fn(async ({ address, functionName }: { address: Hex; functionName: string }) => address.toLowerCase() === actors.oracle.address.toLowerCase()
      ? ({ GUARDIAN_POLICY_VERSION: 2n, isProtected: true, owner: sender, oracle: actors.oracle.address, currentTier: 0,
        getRoute: { tier: 0, tierExpiresAt: 0n, windowSeconds: 3600n } } as Record<string, unknown>)[functionName] : facts[functionName]),
    getContractEvents: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => fromBlock <= 200n && toBlock >= 200n
      ? [{ ...f.destinationReceipt.logs[3], args: { messageId: f.release.messageId, to: beneficiary, amount: f.release.amount } }] : []),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => hash === destinationTx ? f.destinationReceipt : receipts.get(hash) ?? null),
    waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => { const receipt = receipts.get(hash); if (!receipt) throw new Error('Missing synthetic receipt'); return receipt; }),
    simulateContract: vi.fn(async () => { if (facts.paymentsPaused || !facts.permittedRecipients) throw new Error('Customer policy held'); }),
    sendRawTransaction: vi.fn(async ({ serializedTransaction: raw }: { serializedTransaction: Hex }) => {
      published.push(raw);
      if (crash === 'before') { crash = null; throw new Error('Synthetic crash before broadcast'); }
      const parsed = parseTransaction(raw), call = decodeFunctionData({ abi: paymentArtifact.abi, data: parsed.data as Hex });
      const r = facts.releases as [Hex, bigint, number, bigint, Hex, bigint, number];
      if (call.functionName === 'reviewRelease') {
        const [messageId, decision, tier, validUntil, nonce, signature] = call.args as [Hex, number, number, bigint, bigint, Hex];
        const policy = { version: facts.policyVersion as bigint, hash: facts.policyHash as Hex };
        const releaseHash = hashStruct({ types: RELEASE_REVIEW_TYPES, primaryType: 'ReleaseReview', data: {
          messageId, decision, minimumTier: tier, validUntil, nonce, recipient: r[0], amount: r[1], token: route.destination.usdc, routeId,
        } });
        const recovered = await recoverTypedDataAddress({ domain: { name: 'TripwireProtectedVault', version: '2', chainId: route.destination.chainId, verifyingContract: vault },
          types: PAYMENT_RELEASE_REVIEW_TYPES, primaryType: 'PaymentReleaseReview', message: { releaseHash, policyVersion: policy.version, policyHash: policy.hash }, signature });
        expect(recovered).toBe(actors.oracle.address); reviews.push(policy);
        r[2] = decision === 0 ? 1 : decision === 1 ? 2 : 3; r[3] = validUntil; r[5] = nonce;
        if (decision === 0) facts.reviewedPolicyVersion = policy.version;
      } else if (call.functionName === 'executeRelease') r[2] = 4;
      else if (call.functionName === 'executeReturn') { (facts.credits as unknown[])[4] = true; r[2] = 3; }
      else throw new Error('Unexpected write in payment operator fixture');
      latest = 201n; if (autoFinalize) finalized = latest;
      const hash = keccak256(raw); receipts.set(hash, { status: 'success', blockNumber: latest, blockHash: hashes[2], gasUsed: 100_000n, transactionHash: hash });
      if (crash === 'after') { crash = null; throw new Error('Synthetic crash after broadcast'); }
      return hash;
    }),
  };
  const wallet = {
    prepareTransactionRequest: async (request: { to: Hex; data: Hex; value: bigint }) => ({ chainId: route.destination.chainId,
      type: 'eip1559' as const, nonce: transactionNonce++, gas: 1_000_000n, maxFeePerGas: 20n, maxPriorityFeePerGas: 1n, to: request.to, data: request.data, value: request.value }),
    signTransaction: (request: Parameters<typeof actors.oracle.signTransaction>[0]) => actors.oracle.signTransaction(request),
  };
  const source = { ...f.source.port,
    getBlock: async (args: { blockNumber?: bigint }) => ({ number: args.blockNumber ?? 100n, hash: args.blockNumber === 99n ? hashes[0] : f.sourceReceipt.blockHash,
      parentHash: hashes[0], timestamp: 1_780_000_000n }), getContractEvents: async () => [] };
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-payment-rpc-')); dirs.push(dir); const stateFile = join(dir, 'operator.sqlite');
  const cfg = { account: actors.oracle, rpcUrl: 'http://fixture.invalid', etherscanKey: null, deploymentFile: 'unused' };
  const open = () => createCctpRpcOperator(cfg, { pub, wallet, chainId: route.destination.chainId } as unknown as Clients,
    { chainId: route.destination.chainId, route: route.id, routeId, startBlock: '200', vault, guardian: actors.oracle.address, token: route.destination.usdc },
    source as unknown as PublicClient<Transport, Chain>, 100n, stateFile, async () => f.locator,
    { payment: paymentBindings, baseline: { route: route.id, computedAt: 1_780_000_000, windowHours: 24, sampleSize: 100,
      medianTransferUsd: 1000, p95TransferUsd: 10000, rollingTvlUsd: 1000000 } });
  return { facts, f, pub, published, reviews, stateFile, open, crash: (phase: 'before' | 'after') => { crash = phase; },
    deferFinality: () => { autoFinalize = false; }, finalize: () => { finalized = latest; } };
}

describe('customer payment RPC operator integration', () => {
  it('refuses replaced runtime before journal creation or any signed transaction', async () => {
    const f = fixture(); f.pub.getCode.mockResolvedValue('0x');
    await expect(f.open()).rejects.toThrow('bytecode'); expect(existsSync(f.stateFile)).toBe(false); expect(f.published).toEqual([]);
    expect(f.pub.getCode.mock.calls.every(([arg]) => arg.blockNumber === 200n)).toBe(true);
  });
  it('authenticates full receipts, uses policy-bound signatures and persists one executed outcome', async () => {
    const f = fixture(), operator = await f.open();
    try {
      expect((await operator.tick())[0].action).toBe('executed'); expect(f.reviews).toEqual([{ version: 1n, hash: f.f.intent.policyHash }]);
      expect(operator.store.sourceProofs()[0].payment).toEqual(f.f.intent); expect(operator.store.outcomes()[0].action).toBe('executed');
      expect(operator.store.transactions()).toHaveLength(2); expect(await operator.tick()).toEqual([]);
    } finally { operator.close(); }
  });
  it('holds until the client authorizes an old intent at the current policy version', async () => {
    const f = fixture(); f.facts.policyVersion = 2n; f.facts.policyHash = toHex(98, { size: 32 });
    const operator = await f.open();
    try {
      expect((await operator.tick())[0].action).toBe('held'); expect(f.published).toEqual([]);
      f.facts.approvedPolicyVersion = 2n;
      expect((await operator.tick())[0].action).toBe('executed'); expect(f.reviews[0]).toEqual({ version: 2n, hash: f.facts.policyHash });
    } finally { operator.close(); }
  });
  it('waits for finality after completing a customer return rather than losing its queue or crashing', async () => {
    const f = fixture(); (f.facts.credits as unknown[])[3] = 100n; f.facts.paymentsPaused = true; f.deferFinality();
    const operator = await f.open();
    try {
      expect((await operator.tick())[0].action).toBe('retry'); expect(operator.store.loadWatcher()?.pending).toHaveLength(1);
      expect(operator.store.outcomes()).toEqual([]); f.finalize();
      expect((await operator.tick())[0].action).toBe('returned'); expect(operator.store.outcomes()[0].action).toBe('returned');
      expect(f.published).toHaveLength(1); expect(f.reviews).toEqual([]);
    } finally { operator.close(); }
  });
  it.each(['before', 'after'] as const)('recovers customer return %s publication after restart without a second transfer/signature', async (phase) => {
    const f = fixture(); (f.facts.credits as unknown[])[3] = 100n; f.crash(phase); let operator = await f.open();
    f.pub.waitForTransactionReceipt.mockRejectedValueOnce(new Error('Synthetic crash awaiting receipt'));
    await expect(operator.tick()).rejects.toThrow('Synthetic crash'); const signed = operator.store.transactions()[0].raw; operator.close();
    operator = await f.open();
    try {
      expect((await operator.tick())[0].action).toBe('returned'); expect(operator.store.transactions()).toHaveLength(1);
      expect(f.published.every((raw) => raw === signed)).toBe(true); expect(f.published).toHaveLength(phase === 'before' ? 2 : 1);
      expect(operator.store.outcomes()[0].action).toBe('returned');
    } finally { operator.close(); }
  });
  it('refuses the old review format before opening or replaying a journal', async () => {
    const f = fixture(); f.facts.REVIEW_FORMAT_VERSION = 2n;
    await expect(f.open()).rejects.toThrow(); expect(existsSync(f.stateFile)).toBe(false); expect(f.published).toEqual([]);
  });
});
