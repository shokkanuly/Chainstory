// TripwireQuorum installed as the guardian's oracle (ADR-021), in a real EVM.
// Each describe block is one invariant from the contract's header; each test
// tries to break it with fewer, repeated, reordered or outsider signatures.

import { beforeEach, describe, expect, it } from 'vitest';
import { concat, keccak256, slice, toHex, type Hex, type LocalAccount } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import guardianArtifact from '../../../src/tripwire/guardian.artifact.js';
import { GuardianVM, LOCAL_CHAIN_ID, actors, type VMContract } from '../../../src/tripwire/guardianVM.js';
import { ResponseTier, signAttestation, type Attestation } from '../../../src/tripwire/onChain.js';
import demo from '../../../scripts/tripwire/testnet/contracts.artifact.js';
import { ReleaseDecision, signReleaseReview, type ReleaseReview } from '../../../scripts/tripwire/review.js';
import {
  QuorumUnavailableError, localMember, quorumAccount, updateSignersRequest, type QuorumConfig,
} from '../../../scripts/tripwire/quorum.js';

const ROUTE = keccak256(toHex('quorum:eth:base:USDC'));
const MESSAGE = keccak256(toHex('quorum-release'));
const AMOUNT = 40_000n * 10n ** 6n;
const CAP = 2_000_000n * 10n ** 6n;

// Attestor keys sign only; they never send a transaction, so they need no VM balance.
const attestor = (byte: string) => privateKeyToAccount(`0x${byte.repeat(32)}` as Hex);
const ascending = (accounts: LocalAccount[]) => [...accounts].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
const [A, B, C] = ascending([attestor('a1'), attestor('b2'), attestor('c3')]);
const [D, E] = ascending([attestor('d4'), attestor('e5')]);
const OUTSIDER = attestor('f6');

let vm: GuardianVM;
let quorum: VMContract;
let config: QuorumConfig;
let nonce = 0n;

async function deployQuorum(signers: LocalAccount[], threshold: bigint) {
  return vm.deployContract(demo.TripwireQuorum, [signers.map((s) => s.address), threshold]);
}

beforeEach(async () => {
  vm = await GuardianVM.deploy(guardianArtifact);
  quorum = await deployQuorum([A, B, C], 2n);
  config = { address: quorum.address, signers: [A, B, C].map((s) => s.address), threshold: 2 };
  expect((await vm.send(actors.owner, 'configureRoute', [ROUTE, CAP, 3600n])).ok).toBe(true);
  expect((await vm.send(actors.owner, 'setOracle', [quorum.address])).ok).toBe(true);
});

const attestation = (over: Partial<Attestation> = {}): Attestation =>
  ({ routeId: ROUTE, riskScore: 95n, validUntil: vm.now + 300n, nonce: ++nonce, ...over });

/** Each signer's raw 65-byte signature over the guardian's attestation digest. */
async function partsFor(a: Attestation, signers: LocalAccount[]): Promise<Hex[]> {
  return Promise.all(signers.map((s) => signAttestation(s, vm.address, a, LOCAL_CHAIN_ID)));
}

function submit(a: Attestation, signature: Hex) {
  return vm.send(actors.relayer, 'submitAttestation', [a.routeId, a.riskScore, a.validUntil, a.nonce, signature]);
}

describe('no single key attests', () => {
  it('accepts a threshold of distinct attestors in ascending order', async () => {
    const a = attestation();
    expect((await submit(a, concat(await partsFor(a, [A, C]))))).toMatchObject({ ok: true });
    expect(await vm.read('currentTier', [ROUTE])).toBe(ResponseTier.FREEZE);
  });

  it('rejects one attestor, even the previous single oracle key', async () => {
    const a = attestation();
    expect((await submit(a, concat(await partsFor(a, [B]))))).toMatchObject({ ok: false, error: 'InvalidSigner' });
    expect((await submit(a, await signAttestation(actors.oracle, vm.address, a, LOCAL_CHAIN_ID)))).toMatchObject({ ok: false, error: 'InvalidSigner' });
    expect(await vm.read('currentTier', [ROUTE])).toBe(ResponseTier.NONE);
  });

  it('counts a repeated key once', async () => {
    const a = attestation();
    const [sig] = await partsFor(a, [B]);
    expect((await submit(a, concat([sig, sig])))).toMatchObject({ ok: false, error: 'InvalidSigner' });
  });

  it('rejects signatures out of ascending order', async () => {
    const a = attestation();
    expect((await submit(a, concat(await partsFor(a, [C, A]))))).toMatchObject({ ok: false, error: 'InvalidSigner' });
  });

  it('does not count an outsider toward threshold', async () => {
    const a = attestation();
    const signers = ascending([A, OUTSIDER]);
    expect((await submit(a, concat(await partsFor(a, signers))))).toMatchObject({ ok: false, error: 'InvalidSigner' });
  });

  it('rejects a quorum signature over different fields', async () => {
    const a = attestation();
    const forged = concat(await partsFor({ ...a, riskScore: 100n }, [A, B]));
    expect((await submit(a, forged))).toMatchObject({ ok: false, error: 'InvalidSigner' });
  });

  it.each([['empty', '0x'], ['truncated', 'cut'], ['padded', 'pad']] as const)('rejects a %s signature without reverting inside the quorum', async (_name, shape) => {
    const a = attestation();
    const valid = concat(await partsFor(a, [A, B]));
    const signature = shape === 'cut' ? slice(valid, 0, 129) : shape === 'pad' ? concat([valid, '0x00']) : '0x';
    expect((await submit(a, signature as Hex))).toMatchObject({ ok: false, error: 'InvalidSigner' });
  });

  it('still lets a quorum only tighten: a lower score cannot downgrade FREEZE', async () => {
    const freeze = attestation();
    expect((await submit(freeze, concat(await partsFor(freeze, [A, B]))))).toMatchObject({ ok: true });
    const throttle = attestation({ riskScore: 65n });
    expect((await submit(throttle, concat(await partsFor(throttle, [B, C]))))).toMatchObject({ ok: true });
    expect(await vm.read('currentTier', [ROUTE])).toBe(ResponseTier.FREEZE);
  });
});

describe('the quorum is an honest majority', () => {
  it.each([
    ['no signers', [], 1n],
    ['zero threshold', [A, B, C], 0n],
    ['threshold above n', [A, B], 3n],
    ['1-of-2', [A, B], 1n],
    ['2-of-4', [A, B, C, D], 2n],
    ['unsorted', [C, A, B], 2n],
    ['duplicate', [A, A, B], 2n],
  ] as const)('refuses %s', async (_name, signers, threshold) => {
    await expect(deployQuorum([...signers], threshold)).rejects.toThrow('InvalidQuorum');
  });

  it('refuses more than MAX_SIGNERS', async () => {
    const many = ascending(Array.from({ length: 17 }, (_, i) => attestor((i + 16).toString(16))));
    await expect(deployQuorum(many, 9n)).rejects.toThrow('InvalidQuorum');
  });

  it('accepts 1-of-1 for local development and 3-of-5 for production', async () => {
    await expect(deployQuorum([A], 1n)).resolves.toBeDefined();
    await expect(deployQuorum(ascending([A, B, C, D, E]), 3n)).resolves.toBeDefined();
  });
});

describe('membership changes only by quorum', () => {
  async function rotate(signers: LocalAccount[], threshold: bigint, approvers: LocalAccount[], epoch = 0n) {
    const request = updateSignersRequest(quorum.address, LOCAL_CHAIN_ID, { signers: signers.map((s) => s.address), threshold, epoch });
    const parts = await Promise.all(ascending(approvers).map((s) => s.signTypedData(request)));
    const sorted = (request.message as { signers: Hex[] }).signers;
    return vm.sendContract(quorum, actors.relayer, 'updateSigners', [sorted, threshold, concat(parts)]);
  }

  it('rotates with the current quorum, bumps the epoch, and retires removed keys', async () => {
    expect((await rotate([B, D, E], 2n, [A, B]))).toMatchObject({ ok: true });
    expect(await vm.readContract(quorum, 'epoch')).toBe(1n);
    expect(await vm.readContract(quorum, 'isSigner', [A.address])).toBe(false);
    const a = attestation();
    // A was removed: A + B no longer reaches threshold; D + E does.
    expect((await submit(a, concat(await partsFor(a, ascending([A, B])))))).toMatchObject({ ok: false, error: 'InvalidSigner' });
    expect((await submit(a, concat(await partsFor(a, ascending([D, E])))))).toMatchObject({ ok: true });
  });

  it('refuses a minority, an outsider-assisted pair, and a replayed approval', async () => {
    expect((await rotate([D, E, OUTSIDER], 2n, [A]))).toMatchObject({ ok: false, error: 'QuorumNotMet' });
    expect((await rotate([D, E, OUTSIDER], 2n, [A, OUTSIDER]))).toMatchObject({ ok: false, error: 'QuorumNotMet' });
    expect((await rotate([A, B, C], 2n, [A, B]))).toMatchObject({ ok: true });
    // The same approval, signed for epoch 0, cannot be submitted again at epoch 1.
    expect((await rotate([A, B, C], 2n, [A, B], 0n))).toMatchObject({ ok: false, error: 'QuorumNotMet' });
  });

  it('refuses rotating into a non-majority set', async () => {
    expect((await rotate([A, B, C, D], 2n, [A, B]))).toMatchObject({ ok: false, error: 'InvalidQuorum' });
  });
});

describe('release reviews through the quorum', () => {
  async function vaultFixture() {
    const token = await vm.deployContract(demo.DemoUSDC, [actors.owner.address]);
    const vault = await vm.deployContract(demo.ProtectedVault, [actors.owner.address, token.address, vm.address, ROUTE]);
    expect((await vm.send(actors.owner, 'setProtected', [vault.address, ROUTE, true])).ok).toBe(true);
    expect((await vm.sendContract(token, actors.owner, 'mint', [vault.address, AMOUNT * 10n])).ok).toBe(true);
    expect((await vm.sendContract(vault, actors.owner, 'requestRelease', [MESSAGE, actors.bridge.address, AMOUNT])).ok).toBe(true);
    const review = (over: Partial<ReleaseReview> = {}): ReleaseReview => ({
      messageId: MESSAGE, routeId: ROUTE, token: token.address, recipient: actors.bridge.address, amount: AMOUNT,
      decision: ReleaseDecision.ALLOW, minimumTier: ResponseTier.NONE, validUntil: vm.now + 300n, nonce: 1n, ...over,
    });
    const send = (r: ReleaseReview, signature: Hex) => vm.sendContract(vault, actors.relayer, 'reviewRelease',
      [r.messageId, r.decision, r.minimumTier, r.validUntil, r.nonce, signature]);
    return { token, vault, review, send };
  }

  it('pays only after a quorum ALLOW; one attestor cannot approve', async () => {
    const f = await vaultFixture();
    const r = f.review();
    const one = await signReleaseReview(B, f.vault.address, r, LOCAL_CHAIN_ID);
    expect((await f.send(r, one))).toMatchObject({ ok: false, error: 'InvalidReviewer' });
    const account = quorumAccount(config, [localMember(A), localMember(B), localMember(C)]);
    expect((await f.send(r, await signReleaseReview(account, f.vault.address, r, LOCAL_CHAIN_ID)))).toMatchObject({ ok: true });
    expect((await vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE]))).toMatchObject({ ok: true });
    expect(await vm.readContract(f.token, 'balanceOf', [actors.bridge.address])).toBe(AMOUNT);
  });

  it('installing a new quorum invalidates an outstanding quorum ALLOW', async () => {
    const f = await vaultFixture();
    const r = f.review();
    const account = quorumAccount(config, [localMember(A), localMember(B)]);
    expect((await f.send(r, await signReleaseReview(account, f.vault.address, r, LOCAL_CHAIN_ID)))).toMatchObject({ ok: true });
    const next = await deployQuorum(ascending([C, D, E]), 2n);
    expect((await vm.send(actors.owner, 'setOracle', [next.address])).ok).toBe(true);
    expect((await vm.sendContract(f.vault, actors.attacker, 'executeRelease', [MESSAGE]))).toMatchObject({ ok: false, error: 'InvalidReviewer' });
  });

  it('members decide independently: one refusal is tolerated, two block the review', async () => {
    const f = await vaultFixture();
    const r = f.review();
    const refuse = () => false;
    const tolerant = quorumAccount(config, [localMember(A), localMember(B, refuse), localMember(C)]);
    await expect(signReleaseReview(tolerant, f.vault.address, r, LOCAL_CHAIN_ID)).resolves.toMatch(/^0x[0-9a-f]{260}$/);
    const blocked = quorumAccount(config, [localMember(A), localMember(B, refuse), localMember(C, refuse)]);
    await expect(signReleaseReview(blocked, f.vault.address, r, LOCAL_CHAIN_ID)).rejects.toBeInstanceOf(QuorumUnavailableError);
  });
});
