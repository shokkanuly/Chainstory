import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toHex } from 'viem';
import { CctpSourceAdapter, cctpVerifierScope } from '../cctp.js';
import { OperatorStore } from '../store.js';
import { paymentBindings, paymentFixture } from './fixtures/cctpPayment.js';
import { addressWord, beneficiary, bytesReplace, scope, vault } from './fixtures/cctp.js';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.reverse().forEach((f) => f()); cleanup.length = 0; });
function setup(bindings = paymentBindings) {
  const f = paymentFixture(), dir = mkdtempSync(join(tmpdir(), 'tripwire-payment-proof-'));
  const path = join(dir, 'operator.sqlite');
  const bound = { ...scope, sourceVerifier: cctpVerifierScope(vault, 'customer-payment', bindings) };
  const store = new OperatorStore(path, bound);
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close());
  const create = (s: OperatorStore) => new CctpSourceAdapter(s, vault, f.source.port, f.destination.port, async () => f.locator, 'customer-payment', bindings);
  return { ...f, bound, path, store, create, adapter: create(store) };
}
describe('customer payment CCTP source authentication', () => {
  it('persists the exact authenticated intent and rechecks receipts after restart', async () => {
    const f = setup(); expect(await f.adapter.verify(f.release)).toEqual({ status: 'verified', amount: f.release.amount });
    expect(f.store.sourceProofs()[0].payment).toEqual(f.intent);
    f.store.close(); const store = new OperatorStore(f.path, f.bound); cleanup.push(() => store.close());
    expect((await f.create(store).verify(f.release)).status).toBe('verified');
  });
  it.each(['legacy', 'sender', 'return address'])('refuses journal reuse with a different %s scope', async (kind) => {
    const f = setup(); await f.adapter.verify(f.release); f.store.close();
    const next = kind === 'legacy' ? cctpVerifierScope(vault) : cctpVerifierScope(vault, 'customer-payment',
      { ...paymentBindings, ...(kind === 'sender' ? { sourceSender: beneficiary } : { returnRecipient: beneficiary }) });
    expect(() => new OperatorStore(f.path, { ...f.bound, sourceVerifier: next })).toThrow('scope');
  });
  it.each(['sourceSender', 'returnRecipient'] as const)('rejects a mismatching customer %s', async (key) => {
    const f = setup({ ...paymentBindings, [key]: beneficiary });
    expect((await f.adapter.verify(f.release)).status).toBe('invalid'); expect(f.store.sourceProofs()).toEqual([]);
  });
  it.each(['operationId', 'intentPolicyHash', 'messageId'] as const)('rejects a forged binding %s', async (key) => {
    const f = setup(); f.replaceBound({ [key]: toHex(99, { size: 32 }) });
    expect((await f.adapter.verify(f.release)).status).toBe('invalid'); expect(f.store.sourceProofs()).toEqual([]);
  });
  it('rejects a forged return event', async () => {
    const f = setup(); f.replaceBound({ returnRecipient: beneficiary });
    expect((await f.adapter.verify(f.release)).status).toBe('invalid');
  });
  it.each(['missing', 'duplicate', 'early', 'late', 'emitter'])('refuses %s payment binding logs', async (kind) => {
    const f = setup(); const log = f.destinationReceipt.logs[2];
    if (kind === 'missing') f.destinationReceipt.logs.splice(2, 1);
    if (kind === 'duplicate') f.destinationReceipt.logs.push({ ...log, logIndex: 10 });
    if (kind === 'early') log.logIndex = 4;
    if (kind === 'late') log.logIndex = 10;
    if (kind === 'emitter') log.address = beneficiary;
    expect((await f.adapter.verify(f.release)).status).not.toBe('verified');
  });
  it('never lets cached evidence hide changed binding events even without a release origin', async () => {
    const f = setup(); await f.adapter.verify(f.release); f.replaceBound({ operationId: toHex(99, { size: 32 }) });
    expect((await f.adapter.verify({ ...f.release, origin: undefined })).status).toBe('invalid');
  });
  it('checks source sender independently of DepositForBurn pairing', async () => {
    const f = setup(); f.replaceMessage(bytesReplace(f.message, 248, addressWord(beneficiary)));
    f.replaceDeposit({ depositor: beneficiary });
    expect((await f.adapter.verify(f.release)).status).toBe('invalid');
  });
  it('claims a business operation once across distinct otherwise authentic settlements', async () => {
    const f = setup(); await f.adapter.verify(f.release); const p = f.store.sourceProofs()[0];
    expect(f.store.saveSourceProof({ ...p, messageId: toHex(90, { size: 32 }), nonce: toHex(91, { size: 32 }),
      source: { ...p.source, transactionHash: toHex(92, { size: 32 }) }, destination: { ...p.destination, transactionHash: toHex(93, { size: 32 }) } })).toBe('reused');
    expect(f.store.sourceProofs()).toHaveLength(1);
  });
});
