// Synthetic RPC boundary for the screened customer escrow (H4c3b, ADR-048).
// Real review, head and receipt signatures and real CCTP v2-hook source proofs
// over synthetic receipts and state; the provider is the file inbox adapter.
// No public RPC, Circle attester, deployment or screening provider is used.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, hashStruct, keccak256, parseTransaction, recoverTypedDataAddress, stringToHex, toHex, zeroAddress,
  type Chain, type Hex, type PublicClient, type Transport } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { screeningHeadHash, screeningPaymentContextHash, screeningProfileHash, screeningReceiptHash,
  type ScreeningProfile, type ScreeningScope } from '../../../src/chains/evm/screening.js';
import { RELEASE_REVIEW_TYPES, SCREENED_PAYMENT_RELEASE_REVIEW_TYPES } from '../review.js';
import { createCctpRpcOperator } from '../testnet/cctpOperator.js';
import { cctpBindings } from '../testnet/cctpBindings.js';
import type { Clients, TestnetConfig } from '../testnet/sepolia.js';
import screenedArtifact from '../testnet/cctpScreenedPaymentEscrow.artifact.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from '../testnet/artifactAcceptance.js';
import { screeningInbox } from '../testnet/screeningInbox.js';
import { cctpManifestSchema, operatorManifestSchema, pilotManifestSchema } from '../testnet/cctpManifest.js';
import { parseCctpOperatorArgs } from '../testnet/runCctpOperator.js';
import { LOCAL_PROFILE, SCREENING_ISSUER } from '../screenedLocal.js';
import { paymentBindings, paymentFixture } from './fixtures/cctpPayment.js';
import { beneficiary, destinationTx, sender, vault } from './fixtures/cctp.js';

type Release = [Hex, bigint, number, bigint, Hex, bigint, number];
const ZERO = `0x${'0'.repeat(64)}` as Hex;
const wire = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));
const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });

function fixture(opts: { issuer?: Hex } = {}) {
  const f = paymentFixture(2), routeId = keccak256(stringToHex(route.id));
  const guardian = actors.oracle.address.toLowerCase() as Hex;
  const scope: ScreeningScope = { destinationChainId: BigInt(route.destination.chainId), vault, guardian, routeId, token: route.destination.usdc.toLowerCase() as Hex };
  const profile: ScreeningProfile = { version: 1, providerIdHash: LOCAL_PROFILE.providerIdHash, listIdHash: LOCAL_PROFILE.listIdHash,
    issuer: (opts.issuer ?? SCREENING_ISSUER.address).toLowerCase() as Hex, subject: 'payout-recipient', maxObservationAgeSeconds: 300n, maxSnapshotAgeSeconds: 3600n };
  const profileHash = screeningProfileHash(scope, profile);
  const facts: Record<string, unknown> = { ...cctpBindings(vault), REVIEW_FORMAT_VERSION: 4n, PAYMENT_ESCROW_VERSION: 1n, SCREENING_ESCROW_VERSION: 2n,
    policyAuthority: sender, recoveryRecipient: sender, authorizedSourceSender: sender, recoveryDelay: 3600n,
    token: route.destination.usdc, guardian: actors.oracle.address, routeId, MAX_REVIEW_TTL: 600n, RELEASE_POLICY_VERSION: 4n, REJECTION_COOLDOWN: 604_800n, rejectedAt: 0n,
    releases: [beneficiary, f.release.amount, 0, 0n, zeroAddress, 0n, 0] as Release, credits: [sender, f.intent.operationId, f.intent.policyHash, 0n, false],
    policyVersion: 1n, policyHash: f.intent.policyHash, reviewedPolicyVersion: 0n, approvedPolicyVersion: 0n,
    paymentPolicy: [10_000_000n, 5_000_000n, 5_000_000n, 1800n], permittedRecipients: true, paymentsPaused: false, paymentDelayUntil: 0n, releaseDelayUntil: 0n,
    executionMode: 0, screeningProfileHash: profileHash, activeHead: [ZERO, 0n, 0n, 0n], screened: [ZERO, ZERO, 0n] };
  const context = () => {
    const r = facts.releases as Release, c = facts.credits as [Hex, Hex, Hex, bigint, boolean];
    return { ...scope, sourceSender: sender, policyVersion: facts.policyVersion as bigint, policyHash: facts.policyHash as Hex, messageId: f.release.messageId,
      operationId: c[1], recipient: r[0], amount: r[1], returnRecipient: c[0], intentPolicyHash: c[2] };
  };
  let latest = 200n, finalized = 200n, transactionNonce = 0;
  const now = 1_780_000_000n;
  const hashes = [toHex(0, { size: 32 }), f.destinationReceipt.blockHash, toHex(33, { size: 32 })];
  const header = (number: bigint) => ({ number, hash: number === 199n ? hashes[0] : number === 200n ? hashes[1] : hashes[2],
    parentHash: number === 201n ? hashes[1] : hashes[0], timestamp: now, baseFeePerGas: 5n });
  const receipts = new Map<Hex, { status: 'success'; blockNumber: bigint; blockHash: Hex; gasUsed: bigint; transactionHash: Hex }>();
  const published: string[] = [], reviews: { decision: number; receiptHash: Hex }[] = [];
  const pub = {
    getCode: vi.fn(async ({ address }: { address: Hex; blockNumber: bigint }) => address.toLowerCase() === guardian
      ? expectedGuardianRuntime(actors.oracle.address) : expectedPaymentRuntime(vault, actors.oracle.address, paymentBindings, undefined, undefined, 'screened')),
    getBlock: vi.fn(async (args?: { blockNumber?: bigint; blockTag?: string }) => header(args?.blockNumber ?? (args?.blockTag === 'finalized' ? finalized : latest))),
    getChainId: async () => route.destination.chainId,
    readContract: vi.fn(async ({ address, functionName }: { address: Hex; functionName: string }) => address.toLowerCase() === guardian
      ? ({ GUARDIAN_POLICY_VERSION: 4n, isProtected: true, owner: sender, oracle: actors.oracle.address, currentTier: 0,
        getRoute: { tier: 0, tierExpiresAt: 0n, windowSeconds: 3600n }, protectionLimit: 0n } as Record<string, unknown>)[functionName]
      : functionName === 'paymentContextHash' ? screeningPaymentContextHash(context()) : facts[functionName]),
    estimateMaxPriorityFeePerGas: async () => 1n,
    estimateGas: async () => 100_000n,
    getContractEvents: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => fromBlock <= 200n && toBlock >= 200n
      ? [{ ...f.destinationReceipt.logs[3], args: { messageId: f.release.messageId, to: beneficiary, amount: f.release.amount } }] : []),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => hash === destinationTx ? f.destinationReceipt : receipts.get(hash) ?? null),
    waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => { const receipt = receipts.get(hash); if (!receipt) throw new Error('Missing synthetic receipt'); return receipt; }),
    simulateContract: vi.fn(async () => undefined),
    sendRawTransaction: vi.fn(async ({ serializedTransaction: raw }: { serializedTransaction: Hex }) => {
      const call = decodeFunctionData({ abi: screenedArtifact.abi, data: parseTransaction(raw).data as Hex });
      published.push(call.functionName);
      const r = facts.releases as Release;
      if (call.functionName === 'registerScreeningHead') {
        const [revision, snapshotDigest, listAsOf, validUntil] = call.args as [bigint, Hex, bigint, bigint];
        facts.activeHead = [screeningHeadHash(scope, { profileHash, revision, snapshotDigest, listAsOf, validUntil }), revision, listAsOf, validUntil];
      } else if (call.functionName === 'reviewScreenedRelease' || call.functionName === 'reviewRelease') {
        const screened = call.functionName === 'reviewScreenedRelease';
        const [messageId, a1, a2, a3, a4, a5] = call.args as [Hex, number, number | bigint, bigint, bigint | Hex, Hex | Record<string, unknown>];
        const [decision, tier, validUntil, nonce, signature] = screened ? [0, a1, a2 as bigint, a3, a4 as Hex] : [a1, a2 as number, a3, a4 as bigint, a5 as Hex];
        const receipt = screened ? call.args![5] as { profileHash: Hex; headHash: Hex; paymentContextHash: Hex; outcome: number; checkedAt: bigint; validUntil: bigint } : null;
        const commitments = receipt ? { receiptHash: screeningReceiptHash(scope, { ...receipt, outcome: receipt.outcome as 0 | 1 | 2 }), headHash: receipt.headHash, validUntil: receipt.validUntil }
          : { receiptHash: ZERO, headHash: ZERO, validUntil: 0n };
        const releaseHash = hashStruct({ types: RELEASE_REVIEW_TYPES, primaryType: 'ReleaseReview', data: {
          messageId, decision, minimumTier: tier, validUntil, nonce, recipient: r[0], amount: r[1], token: route.destination.usdc, routeId } });
        const recovered = await recoverTypedDataAddress({ domain: { name: 'TripwireProtectedVault', version: '2', chainId: route.destination.chainId, verifyingContract: vault },
          types: SCREENED_PAYMENT_RELEASE_REVIEW_TYPES, primaryType: 'PaymentReleaseReview', message: { releaseHash, policyVersion: facts.policyVersion as bigint,
            policyHash: facts.policyHash as Hex, screeningReceiptHash: commitments.receiptHash, screeningHeadHash: commitments.headHash, screeningValidUntil: commitments.validUntil }, signature });
        expect(recovered).toBe(actors.oracle.address);
        if (receipt) expect(validUntil <= receipt.validUntil).toBe(true);
        reviews.push({ decision, receiptHash: commitments.receiptHash });
        r[2] = decision === 0 ? 1 : decision === 1 ? 2 : 3; r[3] = validUntil; r[5] = nonce;
        facts.screened = [commitments.receiptHash, commitments.headHash, commitments.validUntil];
        if (decision === 0) facts.reviewedPolicyVersion = facts.policyVersion;
      } else if (call.functionName === 'executeRelease') r[2] = 4;
      else if (call.functionName === 'executeReturn') { (facts.credits as unknown[])[4] = true; r[2] = 3; }
      else throw new Error('Unexpected write in screened operator fixture');
      latest = 201n; finalized = latest;
      const hash = keccak256(raw); receipts.set(hash, { status: 'success', blockNumber: latest, blockHash: hashes[2], gasUsed: 100_000n, transactionHash: hash });
      return hash;
    }),
  };
  const wallet = {
    prepareTransactionRequest: async (request: { to: Hex; data: Hex; value: bigint }) => ({ chainId: route.destination.chainId,
      type: 'eip1559' as const, nonce: transactionNonce++, gas: 1_000_000n, maxFeePerGas: 20n, maxPriorityFeePerGas: 1n, to: request.to, data: request.data, value: request.value }),
    signTransaction: ({ account, ...request }: { account: typeof actors.relayer } & Parameters<typeof actors.relayer.signTransaction>[0]) => account.signTransaction(request),
  };
  const source = { ...f.source.port,
    getBlock: async (args: { blockNumber?: bigint }) => ({ number: args.blockNumber ?? 100n, hash: args.blockNumber === 99n ? hashes[0] : f.sourceReceipt.blockHash,
      parentHash: hashes[0], timestamp: 1_780_000_000n }), getContractEvents: async () => [] };
  const dir = mkdtempSync(join(tmpdir(), 'tripwire-screened-rpc-')); dirs.push(dir);
  const stateFile = join(dir, 'operator.sqlite'), inbox = join(dir, 'inbox');
  mkdirSync(inbox, { mode: 0o700 }); // a fresh private inbox
  const cfg: TestnetConfig = { account: actors.relayer, oracle: actors.oracle, relayer: actors.relayer, attestationRelayer: actors.bridge,
    owner: actors.owner.address, singleKey: false, rpcUrls: ['http://fixture.invalid'], maxFeePerGas: 1_000_000_000_000n, etherscanKey: null, deploymentFile: 'unused' };
  /** The issuer integration drops signed evidence for this payment into the inbox. */
  const drop = async (outcome: 0 | 1 | 2 = 1) => {
    const head = { profileHash, revision: 1n, snapshotDigest: keccak256(stringToHex('snapshot-1')), listAsOf: now, validUntil: now + 3600n };
    const headHash = screeningHeadHash(scope, head);
    const receipt = { profileHash, headHash, paymentContextHash: screeningPaymentContextHash(context()), outcome, checkedAt: now, validUntil: now + 300n };
    const evidence = { status: 'available', head: { version: 1, head: wire(head), signature: await SCREENING_ISSUER.sign({ hash: headHash }) },
      receipts: [{ version: 1, receipt: wire(receipt), signature: await SCREENING_ISSUER.sign({ hash: screeningReceiptHash(scope, receipt) }) }] };
    writeFileSync(join(inbox, `${f.release.messageId}.json`), JSON.stringify(evidence));
    return headHash;
  };
  const open = (screening: boolean | 'plain' = true) => createCctpRpcOperator(cfg, { pub, wallet, chainId: route.destination.chainId } as unknown as Clients,
    { chainId: route.destination.chainId, route: route.id, routeId, startBlock: '200', vault, guardian: actors.oracle.address, token: route.destination.usdc },
    source as unknown as PublicClient<Transport, Chain>, 100n, stateFile, async () => f.locator,
    { payment: paymentBindings, ...(screening === true ? { screening: { profile, provider: screeningInbox(inbox) } } : {}),
      baseline: { route: route.id, computedAt: 1_780_000_000, windowHours: 24, sampleSize: 100, medianTransferUsd: 1000, p95TransferUsd: 10000, rollingTvlUsd: 1000000 } });
  return { f, facts, pub, published, reviews, stateFile, inbox, profile, drop, open };
}

describe('screened customer escrow RPC operator (manifest 4)', () => {
  it('authenticates the v2-hook credit, relays the issuer head, signs format 4 with the receipt and pays once', async () => {
    const f = fixture(); const head = await f.drop();
    const operator = await f.open();
    try {
      expect(operator.store.scope.sourceVerifier?.profile).toBe('customer-payment-screened-v1');
      expect((await operator.tick())[0].action).toBe('executed');
      expect(f.published).toEqual(['registerScreeningHead', 'reviewScreenedRelease', 'executeRelease']);
      expect((f.facts.activeHead as Hex[])[0]).toBe(head);
      expect(f.reviews).toEqual([{ decision: 0, receiptHash: expect.not.stringMatching(/^0x0{64}$/) }]);
      expect(operator.store.sourceProofs()[0].payment).toEqual(f.f.intent);
      expect(operator.store.screeningRecords().map((r) => r.kind)).toEqual(['evidence', 'result']);
      expect(operator.store.outcomes()).toEqual([expect.objectContaining({ action: 'executed' })]);
    } finally { operator.close(); }
  });

  it.each([['an empty inbox', null, 'Screening: missing.'], ['a MATCHED receipt', 2, 'Screening: MATCHED.']] as const)('holds on %s', async (_label, outcome, reason) => {
    const f = fixture(); if (outcome !== null) await f.drop(outcome);
    const operator = await f.open();
    try {
      expect((await operator.tick())[0]).toMatchObject({ action: 'held', reason });
      expect(f.published.filter((name) => name !== 'registerScreeningHead')).toEqual([]);
    } finally { operator.close(); }
  });

  it('treats an unreadable inbox entry as an outage, not as evidence', async () => {
    const f = fixture(); writeFileSync(join(f.inbox, `${f.f.release.messageId}.json`), '{not json');
    const operator = await f.open();
    try { expect((await operator.tick())[0]).toMatchObject({ action: 'held', reason: 'Screening: provider-unavailable.' }); }
    finally { operator.close(); }
  });

  it.each([
    ['the plain payment runtime', (f: ReturnType<typeof fixture>) => {
      f.pub.getCode.mockImplementation(async ({ address }) => address.toLowerCase() === actors.oracle.address.toLowerCase()
        ? expectedGuardianRuntime(actors.oracle.address) : expectedPaymentRuntime(vault, actors.oracle.address, paymentBindings));
    }, 'bytecode'],
    ['review format 3', (f: ReturnType<typeof fixture>) => { f.facts.REVIEW_FORMAT_VERSION = 3n; }, 'REVIEW_FORMAT_VERSION'],
    ['another screening profile', (f: ReturnType<typeof fixture>) => { f.facts.screeningProfileHash = keccak256(stringToHex('other profile')); }, 'differs from the accepted'],
  ] as const)('refuses %s before opening a journal or signing (S20)', async (_label, change, message) => {
    const f = fixture(); change(f);
    await expect(f.open()).rejects.toThrow(message); expect(existsSync(f.stateFile)).toBe(false); expect(f.published).toEqual([]);
  });

  it('refuses an issuer that is also a relayer', async () => {
    const f = fixture({ issuer: actors.relayer.address });
    await expect(f.open()).rejects.toThrow('independent'); expect(existsSync(f.stateFile)).toBe(false);
  });

  it('a plain payment operator refuses the screened escrow (S20)', async () => {
    const f = fixture();
    await expect(f.open('plain')).rejects.toThrow(); expect(existsSync(f.stateFile)).toBe(false); expect(f.published).toEqual([]);
  });

  it('starts on a revoked profile and holds payouts, while a matured fixed return still completes (S26)', async () => {
    const f = fixture(); f.facts.screeningProfileHash = ZERO; await f.drop();
    const operator = await f.open();
    try {
      expect((await operator.tick())[0]).toMatchObject({ action: 'held', reason: 'Customer payment policy: screening' });
      expect(f.published).toEqual([]);
    } finally { operator.close(); }
    (f.facts.credits as unknown[])[3] = 100n;
    const restarted = await f.open();
    try {
      expect((await restarted.tick())[0].action).toBe('returned');
      expect(f.published).toEqual(['executeReturn']);
    } finally { restarted.close(); }
  });
});

describe('manifest 4 and the evidence inbox', () => {
  const profile = { version: 1, providerIdHash: LOCAL_PROFILE.providerIdHash, listIdHash: LOCAL_PROFILE.listIdHash, issuer: SCREENING_ISSUER.address,
    subject: 'payout-recipient', maxObservationAgeSeconds: '300', maxSnapshotAgeSeconds: '3600' };
  const manifest = { version: 4, vault, guardian: actors.oracle.address, operator: actors.relayer.address,
    payment: { ...paymentBindings, recoveryDelay: '3600' }, screening: profile, requests: [] };
  it('accepts manifest 4 only with an exact profile; the plain manifest 1–3 loaders keep refusing it', () => {
    expect(operatorManifestSchema.parse(manifest)).toMatchObject({ version: 4, screening: { maxObservationAgeSeconds: 300n, issuer: SCREENING_ISSUER.address.toLowerCase() } });
    expect(() => pilotManifestSchema.parse(manifest)).toThrow();
    expect(() => cctpManifestSchema.parse({ ...manifest, requests: [{ messageId: toHex(1, { size: 32 }), proof: { sourceTransactionHash: toHex(2, { size: 32 }), sourceLogIndex: 0 } }] })).toThrow();
    for (const screening of [{ ...profile, issuer: zeroAddress }, { ...profile, maxObservationAgeSeconds: '29' }, { ...profile, maxSnapshotAgeSeconds: '120', maxObservationAgeSeconds: '300' },
      { ...profile, maxObservationAgeSeconds: 300 }, { ...profile, extra: true }, { ...profile, version: 2 }]) {
      expect(() => operatorManifestSchema.parse({ ...manifest, screening })).toThrow();
    }
    // A manifest 3 never gains screening, and a manifest 4 never loses it.
    expect(() => operatorManifestSchema.parse({ ...manifest, version: 3 })).toThrow();
    const { screening: _dropped, ...withoutScreening } = manifest;
    expect(() => operatorManifestSchema.parse(withoutScreening)).toThrow();
  });
  it('parses the inbox flag only as an explicit directory', () => {
    expect(parseCctpOperatorArgs(['m.json', 's.sqlite', '1', '2', '--screening-inbox=evidence'])).toMatchObject({ screeningInbox: expect.stringMatching(/evidence$/) });
    expect(parseCctpOperatorArgs(['m.json', 's.sqlite', '1', '2']).screeningInbox).toBeUndefined();
    expect(() => parseCctpOperatorArgs(['m.json', 's.sqlite', '1', '2', '--screening-inbox='])).toThrow();
    expect(() => parseCctpOperatorArgs(['m.json', 's.sqlite', '1', '2', '--screening-inbox=a', '--screening-inbox=b'])).toThrow();
  });
  it('reads one bounded file per payment and never lets a path or error text through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tripwire-inbox-')); dirs.push(dir);
    const inbox = screeningInbox(dir), id = toHex(7, { size: 32 });
    const request = { messageId: id, profileHash: id, paymentContextHash: id, activeHeadHash: null };
    expect(await inbox.fetch(request)).toEqual({ status: 'missing' });
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ status: 'provider-unavailable' }));
    expect(await inbox.fetch(request)).toEqual({ status: 'provider-unavailable' });
    writeFileSync(join(dir, `${id}.json`), 'x'.repeat(70_000));
    expect(await inbox.fetch(request)).toEqual({ status: 'provider-unavailable' });
    expect(await inbox.fetch({ ...request, messageId: '../secret' as Hex })).toEqual({ status: 'provider-unavailable' });
    mkdirSync(join(dir, `${toHex(8, { size: 32 })}.json`));
    expect(await inbox.fetch({ ...request, messageId: toHex(8, { size: 32 }) })).toEqual({ status: 'provider-unavailable' });
  });
});
