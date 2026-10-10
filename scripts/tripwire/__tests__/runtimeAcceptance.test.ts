import { describe, expect, it } from 'vitest';
import { toHex } from 'viem';
import { assertRuntime, reconstructRuntime } from '../../../src/chains/evm/runtime.js';
import { actors, LOCAL_CHAIN_ID } from '../../../src/tripwire/guardianVM.js';
import { paymentLocalFixture, PAYMENT_NONCE, PAYMENT_OPERATION, PAYMENT_ROUTE, LOCAL_PAYMENT_POLICY } from '../paymentLocal.js';
import { initialPaymentPolicyHash } from '../../../src/chains/evm/paymentPolicy.js';
import { expectedGuardianRuntime, expectedPaymentRuntime } from '../testnet/artifactAcceptance.js';
import { screenedLocalFixture, SCREENED_ROUTE } from '../screenedLocal.js';
import { cctpPaymentHook, cctpPaymentReleaseId, decodeCctpPaymentHook } from '../../../src/chains/evm/cctp.js';

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
  it('reconstructs the screened escrow from its own template and never accepts one version for the other (S20)', async () => {
    const f = await screenedLocalFixture({ register: false });
    const customer = { authority: actors.owner.address, returnRecipient: actors.bridge.address, sourceSender: actors.owner.address, recoveryDelay: 3600n };
    const bindings = { token: f.token.address, routeId: SCREENED_ROUTE, transmitter: f.transmitter.address, destinationMessenger: actors.bridge.address };
    const code = await f.vm.readBytecode(f.vault.address);
    expect(assertRuntime(code, expectedPaymentRuntime(f.vault.address, f.vm.address, customer, LOCAL_CHAIN_ID, bindings, 'screened')).runtimeBytes).toBe(23_430);
    expect(() => assertRuntime(code, expectedPaymentRuntime(f.vault.address, f.vm.address, customer, LOCAL_CHAIN_ID, bindings))).toThrow('bytecode');
    expect(() => assertRuntime(code, expectedPaymentRuntime(f.vault.address, f.vm.address, { ...customer, recoveryDelay: 7200n }, LOCAL_CHAIN_ID, bindings, 'screened'))).toThrow('bytecode');
    const payment = await paymentLocalFixture();
    const paymentCode = await payment.vm.readBytecode(payment.vault.address);
    expect(() => assertRuntime(paymentCode, expectedPaymentRuntime(payment.vault.address, payment.vm.address, customer, LOCAL_CHAIN_ID,
      { ...bindings, token: payment.token.address, routeId: PAYMENT_ROUTE, transmitter: payment.transmitter.address }, 'screened'))).toThrow('bytecode');
  });
  it('encodes the v2 payment hook and credit ID exactly as the screened escrow does, and never mixes versions', async () => {
    const f = await screenedLocalFixture({ register: false });
    expect(cctpPaymentReleaseId(LOCAL_CHAIN_ID, f.vault.address, 6, PAYMENT_NONCE, 2)).toBe(f.id);
    expect(await f.vm.readContract(f.vault, 'releaseId', [PAYMENT_NONCE])).toBe(f.id);
    expect(cctpPaymentReleaseId(LOCAL_CHAIN_ID, f.vault.address, 6, PAYMENT_NONCE)).not.toBe(f.id);
    const intent = { recipient: actors.attacker.address, returnRecipient: actors.bridge.address, operationId: PAYMENT_OPERATION,
      policyHash: await f.vm.readContract(f.vault, 'policyHash') };
    const hook = cctpPaymentHook(intent, 2);
    // The fixture's message ends with the hook (built independently in screenedLocal.ts).
    expect(f.message().endsWith(hook.slice(2))).toBe(true);
    expect(decodeCctpPaymentHook(hook, 2)).toEqual(decodeCctpPaymentHook(cctpPaymentHook(intent), 1));
    expect(() => decodeCctpPaymentHook(hook)).toThrow('Unsupported');
    expect(() => decodeCctpPaymentHook(cctpPaymentHook(intent), 2)).toThrow('Unsupported');
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
