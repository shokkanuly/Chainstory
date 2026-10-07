import { describe, expect, it } from 'vitest';
import { toHex } from 'viem';
import { assertRuntime, reconstructRuntime } from '../../../src/chains/evm/runtime.js';
import { actors, LOCAL_CHAIN_ID } from '../../../src/tripwire/guardianVM.js';
import { paymentLocalFixture, PAYMENT_ROUTE, LOCAL_PAYMENT_POLICY } from '../paymentLocal.js';
import { initialPaymentPolicyHash } from '../../../src/chains/evm/paymentPolicy.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from '../testnet/artifactAcceptance.js';

describe('exact compiled runtime acceptance', () => {
  it('reconstructs actual constructor-patched guardian and payment code, including EIP-712 caches', async () => {
    const f = await paymentLocalFixture();
    const customer = { authority: actors.owner.address, returnRecipient: actors.bridge.address, sourceSender: actors.owner.address, recoveryDelay: 3600n };
    const bindings = { token: f.token.address, routeId: PAYMENT_ROUTE, transmitter: f.transmitter.address, destinationMessenger: actors.bridge.address };
    const guardianCode = await f.vm.readBytecode(), paymentCode = await f.vm.readBytecode(f.vault.address);
    expect(initialPaymentPolicyHash(LOCAL_CHAIN_ID, f.vault.address, PAYMENT_ROUTE, f.token.address, f.vm.address,
      { ...customer, policy: LOCAL_PAYMENT_POLICY, recipients: [actors.attacker.address] })).toBe(await f.vm.readContract(f.vault, 'policyHash'));
    expect(assertRuntime(guardianCode, expectedGuardianRuntime(f.vm.address, LOCAL_CHAIN_ID)).runtimeBytes).toBeGreaterThan(7000);
    expect(assertRuntime(paymentCode, expectedPaymentRuntime(f.vault.address, f.vm.address, customer, LOCAL_CHAIN_ID, bindings)).runtimeBytes).toBeGreaterThan(15000);
    for (const over of [{ authority: actors.oracle.address }, { sourceSender: actors.bridge.address }, { returnRecipient: actors.owner.address }, { recoveryDelay: 7200n }]) {
      expect(() => assertRuntime(paymentCode, expectedPaymentRuntime(f.vault.address, f.vm.address, { ...customer, ...over }, LOCAL_CHAIN_ID, bindings))).toThrow('bytecode');
    }
    expect(() => assertRuntime(guardianCode, expectedGuardianRuntime(f.vm.address, LOCAL_CHAIN_ID + 1))).toThrow('bytecode');
    expect(() => assertRuntime(guardianCode, expectedGuardianRuntime(actors.owner.address, LOCAL_CHAIN_ID))).toThrow('bytecode');
    expect(() => assertRuntime(paymentCode, expectedPaymentRuntime(f.vault.address, f.vm.address, customer, LOCAL_CHAIN_ID, { ...bindings, token: actors.bridge.address }))).toThrow('bytecode');
    expect(() => assertRuntime('0x', guardianCode)).toThrow('bytecode');
    expect(() => assertRuntime(`${paymentCode.slice(0, -2)}ff`, paymentCode)).toThrow('bytecode');
  });
  const word = toHex(1, { size: 32 });
  const artifact = { creationHash: word, template: `0x${'00'.repeat(64)}`, references: [{ name: 'token', positions: [{ start: 0, length: 32 }] }] };
  it('patches every occurrence and normalizes untrusted hex', () => {
    const a = { ...artifact, references: [{ name: 'token', positions: [{ start: 0, length: 32 }, { start: 32, length: 32 }] }] };
    expect(reconstructRuntime(a, { token: word })).toBe(`${word}${word.slice(2)}`);
    expect(assertRuntime('0xAB', '0xab').runtimeBytes).toBe(1);
  });
  it.each([
    { references: [{ name: 'unknown', positions: [{ start: 0, length: 32 }] }] },
    { references: [{ name: 'token', positions: [{ start: 33, length: 32 }] }] },
    { references: [{ name: 'token', positions: [{ start: 0, length: 32 }, { start: 1, length: 32 }] }] },
    { references: [artifact.references[0], artifact.references[0]] },
    { template: `0xff${'00'.repeat(63)}` },
  ])('refuses missing, overlapping, out-of-bounds or nonempty compiler patches %j', (over) => {
    expect(() => reconstructRuntime({ ...artifact, ...over }, { token: word })).toThrow();
  });
});
