import { readFileSync } from 'node:fs';
import solc from 'solc';
import { describe, expect, it } from 'vitest';
import { concatHex, keccak256, toHex, zeroAddress, type Hex } from 'viem';
import { standardJsonInput } from '../compile.mjs';
import guardian from '../../../src/tripwire/guardian.artifact.js';
import demo from '../../../scripts/tripwire/testnet/contracts.artifact.js';
import escrowArtifact from '../../../scripts/tripwire/testnet/cctpEscrow.artifact.js';
import { actors, GuardianVM, LOCAL_CHAIN_ID, type GuardianArtifact } from '../../../src/tripwire/guardianVM.js';
import { cctpAddressWord, cctpBeneficiaryHook, cctpEscrowReleaseId } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { bytesReplace, nonce } from '../../../scripts/tripwire/__tests__/fixtures/cctp.js';
import { ReleaseDecision, signReleaseReview } from '../../../scripts/tripwire/review.js';
import { ResponseTier } from '../../../src/tripwire/onChain.js';

const input = standardJsonInput('TripwireDemo.sol');
input.sources['CctpHarness.sol'] = { content: readFileSync(new URL('./fixtures/CctpHarness.sol', import.meta.url), 'utf8')
  .replace('../../src/TripwireDemo.sol', 'TripwireDemo.sol') };
const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
if (compiled.errors?.some((e: { severity: string }) => e.severity === 'error')) throw new Error(JSON.stringify(compiled.errors));
const harness: GuardianArtifact = { abi: compiled.contracts['CctpHarness.sol'].CctpHarness.abi,
  bytecode: `0x${compiled.contracts['CctpHarness.sol'].CctpHarness.evm.bytecode.object}` };
const ROUTE = keccak256(toHex('authenticated-cctp-test'));
const AMOUNT = 1_000_001n, FEE = 100n, NET = AMOUNT - FEE;
const u32 = (v: number) => toHex(v, { size: 4 });
const u256 = (v: bigint) => toHex(v, { size: 32 });

async function setup() {
  const vm = await GuardianVM.deploy(guardian);
  const token = await vm.deployContract(demo.DemoUSDC, [actors.owner.address]);
  const transmitter = await vm.deployContract(harness, [actors.relayer.address, token.address]);
  const vault = await vm.deployContract(escrowArtifact, [token.address, vm.address, ROUTE,
    { transmitter: transmitter.address, destinationMessenger: actors.bridge.address, sourceDomain: 6,
      sourceMessenger: route.source.messenger, sourceToken: route.source.usdc }]);
  // Existing pooled balance must never count as funding for a fresh request.
  await vm.sendContract(token, actors.owner, 'mint', [vault.address, NET * 10n]);
  await vm.sendContract(token, actors.owner, 'transferOwnership', [transmitter.address]);
  await vm.send(actors.owner, 'configureRoute', [ROUTE, NET * 100n, 3600n]);
  await vm.send(actors.owner, 'setProtected', [vault.address, true]);
  const body = concatHex([u32(1), cctpAddressWord(route.source.usdc), cctpAddressWord(vault.address), u256(AMOUNT),
    cctpAddressWord(actors.owner.address), u256(1000n), u256(FEE), u256(0n), cctpBeneficiaryHook(actors.attacker.address)]);
  const message = concatHex([u32(1), u32(6), u32(0), nonce, cctpAddressWord(route.source.messenger),
    cctpAddressWord(actors.bridge.address), cctpAddressWord(vault.address), u32(2000), u32(2000), body]);
  const id = cctpEscrowReleaseId(LOCAL_CHAIN_ID, vault.address, 6, nonce);
  const receive = async (raw = message, signer = actors.relayer) => vm.sendContract(vault, actors.attacker, 'receiveCctp',
    [raw, await signer.sign({ hash: keccak256(raw) })]);
  const review = async (over = {}) => {
    const r = { messageId: id, routeId: ROUTE, token: token.address, recipient: actors.attacker.address, amount: NET,
      decision: ReleaseDecision.ALLOW, minimumTier: ResponseTier.NONE, validUntil: vm.now + 300n, nonce: 1n, ...over };
    const signature = await signReleaseReview(actors.oracle, vault.address, r, LOCAL_CHAIN_ID);
    return vm.sendContract(vault, actors.owner, 'reviewRelease', [id, r.decision, r.minimumTier, r.validUntil, r.nonce, signature]);
  };
  return { vm, token, transmitter, vault, message, id, receive, review };
}

describe('authenticated CCTP escrow', () => {
  it('creates an immutable pending credit for exactly the net mint and requires review before paying once', async () => {
    const f = await setup();
    expect((await f.vm.readContract<string>(f.vault, 'owner')).toLowerCase()).toBe(f.vault.address);
    expect(await f.vm.readContract(f.vault, 'releaseId', [nonce])).toBe(f.id);
    expect((await f.receive()).ok).toBe(true);
    expect(await f.vm.readContract(f.vault, 'releases', [f.id])).toEqual([
      actors.attacker.address, NET, 0, 0n, zeroAddress, 0n, 0,
    ]);
    expect(await f.vm.readContract(f.vault, 'fundedMessageHash', [f.id])).toBe(keccak256(f.message));
    expect((await f.vm.sendContract(f.vault, actors.owner, 'executeRelease', [f.id])).error).toBe('ReleaseNotReviewed');
    expect((await f.review()).ok).toBe(true);
    expect((await f.vm.sendContract(f.vault, actors.owner, 'executeRelease', [f.id])).ok).toBe(true);
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.attacker.address])).toBe(NET);
    expect((await f.vm.sendContract(f.vault, actors.owner, 'executeRelease', [f.id])).error).toBe('AlreadyExecuted');
    expect((await f.receive()).error).toBe('CctpNonceUsed');
  });
  it.each(['owner', 'oracle', 'attacker'] as const)('prevents %s creating credits or taking escrow ownership', async (actor) => {
    const f = await setup();
    for (const [name, args] of [['requestRelease', [f.id, actors[actor].address, NET]],
      ['transferOwnership', [actors[actor].address]], ['renounceOwnership', []]] as const) {
      expect((await f.vm.sendContract(f.vault, actors[actor], name, args)).error).toBe('OwnableUnauthorizedAccount');
    }
    expect((await f.review()).error).toBe('UnknownRelease');
  });
  it('rejects a Tripwire oracle signature as a Circle attestation', async () => {
    const f = await setup(); expect((await f.receive(f.message, actors.oracle)).ok).toBe(false);
    expect(await f.vm.readContract(f.vault, 'usedCctpNonces', [nonce])).toBe(false);
    expect(await f.vm.readContract(f.token, 'balanceOf', [f.vault.address])).toBe(NET * 10n);
  });
  it('forbids direct transmitter minting even with a valid attestation', async () => {
    const f = await setup();
    expect((await f.vm.sendContract(f.transmitter, actors.owner, 'receiveMessage', [f.message,
      await actors.relayer.sign({ hash: keccak256(f.message) })])).ok).toBe(false);
  });
  it.each([
    ['header version', 0, u32(2)], ['source domain', 4, u32(0)], ['destination domain', 8, u32(6)],
    ['zero nonce', 12, u256(0n)], ['source messenger', 44, cctpAddressWord(actors.owner.address)],
    ['destination messenger', 76, cctpAddressWord(actors.owner.address)], ['unrestricted caller', 108, cctpAddressWord(zeroAddress)],
    ['minimum finality', 140, u32(1000)], ['executed finality', 144, u32(1000)], ['body version', 148, u32(2)],
    ['burn token', 152, cctpAddressWord(actors.owner.address)], ['mint recipient', 184, cctpAddressWord(actors.owner.address)],
    ['zero gross', 216, u256(0n)], ['max fee consumes gross', 280, u256(AMOUNT)],
    ['fee exceeds max', 312, u256(1001n)], ['expired transfer', 344, u256(1n)], ['hook version', 376, u256(0n)],
    ['zero beneficiary', 408, cctpAddressWord(zeroAddress)], ['sender padding', 248, `0x01${'00'.repeat(31)}` as Hex],
    ['beneficiary padding', 408, `0x01${'00'.repeat(31)}` as Hex],
  ])('rejects %s before minting or creating a credit', async (_field, offset, replacement) => {
    const f = await setup(); expect((await f.receive(bytesReplace(f.message, offset as number, replacement as Hex))).ok).toBe(false);
    expect(await f.vm.readContract(f.token, 'balanceOf', [f.vault.address])).toBe(NET * 10n);
    expect(await f.vm.readContract(f.vault, 'usedCctpNonces', [nonce])).toBe(false);
    expect(await f.vm.readContract(f.vault, 'fundedMessageHash', [f.id])).toBe(u256(0n));
  });
  it.each(['short', 'extra'])('rejects a %s message', async (kind) => {
    const f = await setup(); expect((await f.receive(kind === 'short' ? '0x00' : concatHex([f.message, '0x00']))).ok).toBe(false);
  });
  it.each([1, 2, 3, 4, 5])('rolls back mint, both nonce claims and credit when the transmitter fault is %i', async (fault) => {
    const f = await setup(); await f.vm.sendContract(f.transmitter, actors.owner, 'setFault', [BigInt(fault)]);
    expect((await f.receive()).ok).toBe(false);
    expect(await f.vm.readContract(f.token, 'balanceOf', [f.vault.address])).toBe(NET * 10n);
    expect(await f.vm.readContract(f.transmitter, 'usedNonces', [nonce])).toBe(0n);
    expect(await f.vm.readContract(f.vault, 'usedCctpNonces', [nonce])).toBe(false);
    expect(await f.vm.readContract(f.vault, 'fundedMessageHash', [f.id])).toBe(u256(0n));
    await f.vm.sendContract(f.transmitter, actors.owner, 'setFault', [0n]); expect((await f.receive()).ok).toBe(true);
  });
  it('rejects reviews changing the funded amount or beneficiary and preserves guardian limits', async () => {
    const f = await setup(); await f.receive();
    expect((await f.review({ amount: NET + 1n })).error).toBe('InvalidReviewer');
    expect((await f.review({ recipient: actors.owner.address })).error).toBe('InvalidReviewer');
    expect((await f.review()).ok).toBe(true);
    await f.vm.send(actors.owner, 'configureRoute', [ROUTE, NET - 1n, 3600n]);
    expect((await f.vm.sendContract(f.vault, actors.owner, 'executeRelease', [f.id])).error).toBe('RateLimited');
    expect(await f.vm.readContract(f.token, 'balanceOf', [actors.attacker.address])).toBe(0n);
  });
  it.each(['token', 'guardian', 'route', 'transmitter', 'destinationMessenger', 'sourceMessenger', 'sourceToken', 'sourceDomain'])
    ('refuses an invalid %s constructor binding', async (field) => {
      const f = await setup();
      const config = { transmitter: f.transmitter.address, destinationMessenger: actors.bridge.address, sourceDomain: 6,
        sourceMessenger: route.source.messenger, sourceToken: route.source.usdc };
      if (field in config) Object.assign(config, { [field]: field === 'sourceDomain' ? 0 : zeroAddress });
      await expect(f.vm.deployContract(escrowArtifact, [field === 'token' ? zeroAddress : f.token.address,
        field === 'guardian' ? zeroAddress : f.vm.address, field === 'route' ? u256(0n) : ROUTE, config])).rejects.toThrow('InvalidCctpConfiguration');
    });
});
