import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import { cctpAttestedMessage, cctpEscrowReleaseId } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { CctpSourceAdapter, cctpVerifierScope } from '../cctp.js';
import { OperatorStore } from '../store.js';
import { authenticatedFixture } from './fixtures/cctpEscrow.js';
import { beneficiary, bytesReplace, nonce, scope, sender, vault, addressWord } from './fixtures/cctp.js';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.reverse().forEach((fn) => fn()); cleanups.length = 0; });
function setup() {
  const f = authenticatedFixture(); const dir = mkdtempSync(join(tmpdir(), 'tripwire-escrow-'));
  const path = join(dir, 'operator.sqlite'); const bound = { ...scope, sourceVerifier: cctpVerifierScope(vault, 'authenticated-escrow') };
  const store = new OperatorStore(path, bound);
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close());
  const create = (s: OperatorStore) => new CctpSourceAdapter(s, vault, f.source.port, f.destination.port, async () => f.locator, 'authenticated-escrow');
  return { ...f, store, path, bound, create, adapter: create(store) };
}

describe('CCTP authenticated escrow source evidence', () => {
  it('pairs the mint and credit atomically and preserves accepted proof across restart', async () => {
    const f = setup(); expect(await f.adapter.verify(f.release)).toEqual({ status: 'verified', amount: f.release.amount });
    f.store.close(); const next = new OperatorStore(f.path, f.bound); cleanups.push(() => next.close());
    expect(await f.create(next).verify(f.release)).toEqual({ status: 'verified', amount: f.release.amount });
    expect(next.sourceProofs()).toHaveLength(1);
  });
  it('refuses a legacy policy database without erasing accepted claims', async () => {
    const f = setup(); await f.adapter.verify(f.release); f.store.close();
    const legacyPath = join(f.path, '..', 'legacy.sqlite'); const legacy = new OperatorStore(legacyPath, scope);
    cleanups.push(() => legacy.close());
    expect(() => new CctpSourceAdapter(legacy, vault, f.source.port, f.destination.port, async () => f.locator)).toThrow('scope');
    expect(() => new OperatorStore(f.path, scope)).toThrow();
    const next = new OperatorStore(f.path, f.bound); cleanups.push(() => next.close()); expect(next.sourceProofs()).toHaveLength(1);
  });
  it('rejects an ID not bound to the authenticated nonce', async () => {
    const f = setup(); expect((await f.adapter.verify({ ...f.release, messageId: nonce })).status).toBe('invalid');
  });
  it('requires the escrow as the source destinationCaller and the receiving caller', async () => {
    const f = setup(); f.replaceMessage(bytesReplace(f.message, 108, addressWord(sender))); f.replaceDeposit({ destinationCaller: addressWord(sender) });
    expect((await f.adapter.verify(f.release)).status).toBe('invalid');
    f.replaceMessage(f.message); f.replaceDeposit({ destinationCaller: addressWord(vault) }); f.replaceReceive({ caller: sender });
    expect((await f.adapter.verify(f.release)).status).toBe('invalid');
  });
  it.each([2, 3])('holds if credit event %i is absent from the mint transaction', async (index) => {
    const f = setup(); f.destinationReceipt.logs.splice(index, 1);
    expect((await f.adapter.verify(f.release)).status).toBe('unavailable'); expect(f.store.sourceProofs()).toEqual([]);
  });
  it.each([
    ['nonce', { nonce: toHex(1, { size: 32 }) }], ['message hash', { messageHash: nonce }],
    ['amount', { amount: 1n }], ['ID', { messageId: nonce }],
  ])('rejects funded %s differing from authenticated settlement', async (_field, over) => {
    const f = setup(); f.replaceFunded(over);
    expect((await f.adapter.verify(f.release)).status).toBe('invalid'); expect(f.store.sourceProofs()).toEqual([]);
  });
  it.each([{ to: sender }, { amount: 1n }, { messageId: nonce }])('rejects changed requested fields %s', async (over) => {
    const f = setup(); f.replaceRequested(over); expect((await f.adapter.verify(f.release)).status).toBe('invalid');
  });
  it.each(['early request', 'early funded', 'duplicate', 'wrong emitter'])('holds or rejects %s credit logs', async (kind) => {
    const f = setup();
    if (kind === 'early request') f.destinationReceipt.logs[2].logIndex = 4;
    if (kind === 'early funded') f.destinationReceipt.logs[3].logIndex = 4;
    if (kind === 'duplicate') f.destinationReceipt.logs.push({ ...f.destinationReceipt.logs[3], logIndex: 9 });
    if (kind === 'wrong emitter') f.destinationReceipt.logs[3].address = sender;
    expect((await f.adapter.verify(f.release)).status).not.toBe('verified');
  });
  it('rechecks request provenance even after the source proof was cached', async () => {
    const f = setup(); await f.adapter.verify(f.release);
    expect((await f.adapter.verify({ ...f.release, origin: { ...f.release.origin!, logIndex: 9 } })).status).toBe('invalid');
    expect((await f.adapter.verify({ ...f.release, recipient: beneficiary, origin: undefined })).status).toBe('verified');
  });
  it('refuses a second settlement and nonce claiming the same source burn', async () => {
    const f = setup(); await f.adapter.verify(f.release);
    const secondNonce = toHex(2, { size: 32 }), transactionHash = toHex(3, { size: 32 });
    f.release.messageId = cctpEscrowReleaseId(route.destination.chainId, vault, 6, secondNonce);
    f.replaceReceive({ nonce: secondNonce, caller: vault });
    f.replaceRequested({ messageId: f.release.messageId });
    f.replaceFunded({ messageId: f.release.messageId, nonce: secondNonce,
      messageHash: keccak256(cctpAttestedMessage(f.message, secondNonce, 2000, f.receivedBody)) });
    f.destinationReceipt.transactionHash = transactionHash;
    f.destinationReceipt.logs.forEach((log) => { log.transactionHash = transactionHash; });
    f.locator.destinationTransactionHash = transactionHash;
    f.release.origin!.transactionHash = transactionHash;
    expect((await f.adapter.verify(f.release)).status).toBe('invalid'); expect(f.store.sourceProofs()).toHaveLength(1);
  });
});
