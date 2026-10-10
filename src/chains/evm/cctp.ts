// Pure CCTP v2 codec. Unknown formats fail closed at the operator boundary.
import { concatHex, encodeAbiParameters, hexToBigInt, keccak256, padHex, stringToHex, toHex, type Hex } from 'viem';
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

// New payment escrow convention; legacy 64-byte hooks remain separately decoded.
export const TRIPWIRE_CCTP_PAYMENT_HOOK_V1 = keccak256(stringToHex('Tripwire/CCTP/v2/USDC/payment/v1'));
/** The screened payment escrow's own hook and credit namespace (ADR-047): a v1 credit is never reinterpreted. */
export const TRIPWIRE_CCTP_PAYMENT_HOOK_V2 = keccak256(stringToHex('Tripwire/CCTP/v2/USDC/payment/v2'));
export type CctpPaymentVersion = 1 | 2;
const paymentHookPrefix = (version: CctpPaymentVersion) => version === 2 ? TRIPWIRE_CCTP_PAYMENT_HOOK_V2 : TRIPWIRE_CCTP_PAYMENT_HOOK_V1;
const nonzeroHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v.toLowerCase() as Hex)
  .refine((v) => !/^0x0{64}$/.test(v), 'A nonzero commitment is required.');
export const cctpPaymentIntentSchema = z.object({
  recipient: cctpAddressSchema.refine((v) => !/^0x0{40}$/.test(v)),
  returnRecipient: cctpAddressSchema.refine((v) => !/^0x0{40}$/.test(v)),
  operationId: nonzeroHash, policyHash: nonzeroHash,
}).strict();
export function cctpPaymentHook(input: unknown, version: CctpPaymentVersion = 1): Hex {
  const intent = cctpPaymentIntentSchema.parse(input);
  return concatHex([paymentHookPrefix(version), cctpAddressWord(intent.recipient),
    cctpAddressWord(intent.returnRecipient), intent.operationId, intent.policyHash]);
}
export function decodeCctpPaymentHook(input: unknown, version: CctpPaymentVersion = 1) {
  const raw = cctpBytesSchema.parse(input);
  if (raw.length !== 322 || field(raw, 0, 32) !== paymentHookPrefix(version)) throw new Error('Unsupported Tripwire payment hook.');
  return cctpPaymentIntentSchema.parse({ recipient: addressAt(raw, 32), returnRecipient: addressAt(raw, 64),
    operationId: field(raw, 96, 32), policyHash: field(raw, 128, 32) });
}
export function cctpPaymentReleaseId(chainId: number, vault: string, sourceDomain: number, nonce: Hex, version: CctpPaymentVersion = 1): Hex {
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(chainId);
  z.number().int().nonnegative().max(0xffffffff).parse(sourceDomain);
  z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(nonce);
  return keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint32' }, { type: 'bytes32' },
  ], [keccak256(stringToHex(`Tripwire/CCTP/v2/payment-escrow/v${version}`)), BigInt(chainId), cctpAddressSchema.parse(vault), sourceDomain, nonce]));
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

// Destination escrow identity: available on-chain in the attested message.
// Source tx/log uniqueness is still enforced independently by the operator.
export function cctpEscrowReleaseId(chainId: number, vault: string, sourceDomain: number, nonce: Hex): Hex {
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(chainId);
  z.number().int().nonnegative().max(0xffffffff).parse(sourceDomain);
  z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(nonce);
  return keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint32' }, { type: 'bytes32' },
  ], [keccak256(stringToHex('Tripwire/CCTP/v2/escrow/v1')), BigInt(chainId), cctpAddressSchema.parse(vault), sourceDomain, nonce]));
}

export function cctpAttestedMessage(sourceMessage: Hex, nonce: Hex, finality: number, receivedBody: Hex): Hex {
  const source = decodeCctpMessage(sourceMessage);
  z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(nonce);
  z.number().int().nonnegative().max(0xffffffff).parse(finality);
  decodeCctpBurnBody(receivedBody);
  // Keep version/domains and sender/recipient/caller/minimum finality;
  // replace exactly the attester-assigned nonce, executed finality and body.
  return concatHex([field(source.raw, 0, 12), nonce, field(source.raw, 44, 100),
    toHex(finality, { size: 4 }), receivedBody]);
}
