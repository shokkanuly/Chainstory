// Pure CCTP v2 codec. Unknown formats fail closed at the operator boundary.
import { concatHex, encodeAbiParameters, hexToBigInt, keccak256, padHex, stringToHex, type Hex } from 'viem';
import { z } from 'zod';

export const cctpAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase() as Hex);
export const cctpBytesSchema = z.string().regex(/^0x([0-9a-fA-F]{2})*$/).max(8194).transform((v) => v.toLowerCase() as Hex);
const field = (raw: Hex, offset: number, bytes: number) => `0x${raw.slice(2 + offset * 2, 2 + (offset + bytes) * 2)}` as Hex;
const uint = (raw: Hex, offset: number, bytes = 32) => hexToBigInt(field(raw, offset, bytes));
export const cctpAddressWord = (address: string) => padHex(cctpAddressSchema.parse(address), { size: 32 });
const addressAt = (raw: Hex, offset: number): Hex => {
  const word = field(raw, offset, 32);
  if (!/^0x0{24}[0-9a-f]{40}$/.test(word)) throw new Error('CCTP EVM address has nonzero padding.');
  return `0x${word.slice(-40)}`;
};

export function decodeCctpBurnBody(input: unknown) {
  const raw = cctpBytesSchema.parse(input);
  if ((raw.length - 2) / 2 < 228 || uint(raw, 0, 4) !== 1n) throw new Error('Unsupported CCTP burn body.');
  return { raw, burnToken: addressAt(raw, 4), mintRecipient: addressAt(raw, 36), amount: uint(raw, 68),
    messageSender: addressAt(raw, 100), maxFee: uint(raw, 132), feeExecuted: uint(raw, 164),
    expirationBlock: uint(raw, 196), hookData: `0x${raw.slice(2 + 228 * 2)}` as Hex };
}
export function decodeCctpMessage(input: unknown) {
  const raw = cctpBytesSchema.parse(input);
  if ((raw.length - 2) / 2 < 376 || uint(raw, 0, 4) !== 1n) throw new Error('Unsupported CCTP message.');
  return { raw, sourceDomain: Number(uint(raw, 4, 4)), destinationDomain: Number(uint(raw, 8, 4)),
    nonce: field(raw, 12, 32), sender: addressAt(raw, 44), recipient: addressAt(raw, 76),
    destinationCaller: addressAt(raw, 108), minFinalityThreshold: Number(uint(raw, 140, 4)),
    finalityThresholdExecuted: Number(uint(raw, 144, 4)), body: decodeCctpBurnBody(`0x${raw.slice(2 + 148 * 2)}`) };
}

// Tripwire application convention, NOT a Circle hook standard or executable call.
export const TRIPWIRE_CCTP_HOOK_V1 = keccak256(stringToHex('Tripwire/CCTP/v2/USDC/beneficiary/v1'));
export function cctpBeneficiaryHook(recipient: string): Hex {
  return concatHex([TRIPWIRE_CCTP_HOOK_V1, cctpAddressWord(recipient)]);
}
export function cctpHookBeneficiary(input: unknown): Hex {
  const raw = cctpBytesSchema.parse(input);
  if (raw.length !== 130 || field(raw, 0, 32) !== TRIPWIRE_CCTP_HOOK_V1) throw new Error('Unsupported Tripwire beneficiary hook.');
  const recipient = addressAt(raw, 32);
  if (/^0x0{40}$/.test(recipient)) throw new Error('Zero beneficiary.');
  return recipient;
}

// Stable source identity: v2's attester-assigned nonce is absent in MessageSent.
export function cctpReleaseId(chainId: number, transmitter: string, transactionHash: Hex, logIndex: number): Hex {
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(chainId);
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(logIndex);
  z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(transactionHash);
  return keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint256' },
  ], [keccak256(stringToHex('Tripwire/CCTP/v2/source/v1')), BigInt(chainId), cctpAddressSchema.parse(transmitter), transactionHash, BigInt(logIndex)]));
}
