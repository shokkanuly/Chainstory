import { describe, expect, it } from 'vitest';
import { concatHex, keccak256, toHex, zeroAddress, type Hex } from 'viem';
import { cctpBeneficiaryHook, cctpEscrowReleaseId, cctpPaymentHook, cctpPaymentReleaseId, decodeCctpPaymentHook } from '../cctp.js';

const recipient = '0x1111111111111111111111111111111111111111';
const returnRecipient = '0x2222222222222222222222222222222222222222';
const intent = { recipient, returnRecipient, operationId: keccak256(toHex('business-payment')), policyHash: keccak256(toHex('policy')) };
describe('Tripwire payment intent convention: synthetic vectors', () => {
  it('round trips exactly five words with independent payout/return addresses', () => {
    const raw = cctpPaymentHook(intent);
    expect(raw.length).toBe(322);
    expect(decodeCctpPaymentHook(raw)).toEqual(intent);
  });
  it.each(['recipient', 'returnRecipient', 'operationId', 'policyHash'] as const)('rejects zero %s', (field) => {
    expect(() => cctpPaymentHook({ ...intent, [field]: field.endsWith('Id') || field.endsWith('Hash') ? toHex(0n, { size: 32 }) : zeroAddress })).toThrow();
  });
  it.each(['short', 'extra', 'legacy', 'padding'])('rejects %s data instead of dropping a commitment', (kind) => {
    const raw = cctpPaymentHook(intent);
    const bad = kind === 'short' ? '0x00' : kind === 'extra' ? concatHex([raw, '0x00']) :
      kind === 'legacy' ? cctpBeneficiaryHook(recipient) : `0x${raw.slice(2, 66)}01${raw.slice(68)}`;
    expect(() => decodeCctpPaymentHook(bad)).toThrow();
  });
  it('payment identities bind deployment, chain, source domain and nonce, distinct from legacy', () => {
    const nonce = toHex(1n, { size: 32 }); const id = cctpPaymentReleaseId(1, recipient, 6, nonce);
    const others: Hex[] = [cctpPaymentReleaseId(2, recipient, 6, nonce), cctpPaymentReleaseId(1, returnRecipient, 6, nonce),
      cctpPaymentReleaseId(1, recipient, 0, nonce), cctpPaymentReleaseId(1, recipient, 6, toHex(2n, { size: 32 })),
      cctpEscrowReleaseId(1, recipient, 6, nonce)];
    expect(others.every((other) => other !== id)).toBe(true);
  });
});
