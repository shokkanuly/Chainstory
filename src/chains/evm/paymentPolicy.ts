// Our constructor's canonical initial policy identity; not JSON hashing.
import { concatHex, encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema } from './cctp.js';

const units = z.bigint().nonnegative().max((1n << 256n) - 1n);
const configuration = z.object({ authority: cctpAddressSchema, returnRecipient: cctpAddressSchema, sourceSender: cctpAddressSchema,
  recoveryDelay: units, policy: z.object({ maxPayment: units, manualApprovalAbove: units, delayAbove: units, delaySeconds: units }).strict(),
  recipients: z.array(cctpAddressSchema).max(100),
}).strict();
const constructorPart = (namespace: string, chainId: number, vault: Hex, routeId: Hex, token: Hex, guardian: Hex, input: unknown): Hex => {
  const config = configuration.parse(input);
  const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(chainId);
  return encodeAbiParameters([
    { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' }, { type: 'address' },
    { type: 'tuple', components: [
      { name: 'authority', type: 'address' }, { name: 'returnRecipient', type: 'address' }, { name: 'sourceSender', type: 'address' },
      { name: 'recoveryDelay', type: 'uint256' },
      { name: 'policy', type: 'tuple', components: [{ name: 'maxPayment', type: 'uint256' }, { name: 'manualApprovalAbove', type: 'uint256' },
        { name: 'delayAbove', type: 'uint256' }, { name: 'delaySeconds', type: 'uint256' }] },
      { name: 'recipients', type: 'address[]' },
    ] },
  ], [keccak256(stringToHex(namespace)), BigInt(id), cctpAddressSchema.parse(vault), routeId,
    cctpAddressSchema.parse(token), cctpAddressSchema.parse(guardian), config]);
};
export function initialPaymentPolicyHash(chainId: number, vault: Hex, routeId: Hex, token: Hex, guardian: Hex, input: unknown): Hex {
  return keccak256(constructorPart('Tripwire/CCTP/v2/payment-escrow/v1', chainId, vault, routeId, token, guardian, input));
}
/**
 * The screened escrow's initial policy (ADR-047): the v2 namespace and the same
 * constructor bindings, then legacy execution mode (0) and the profile hash,
 * as `bytes.concat(abi.encode(...), abi.encode(uint8, bytes32))`.
 */
export function initialScreenedPolicyHash(chainId: number, vault: Hex, routeId: Hex, token: Hex, guardian: Hex, input: unknown, profileHash: Hex): Hex {
  const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).refine((v) => !/^0x0{64}$/.test(v), 'Zero profile hash.').parse(profileHash) as Hex;
  return keccak256(concatHex([constructorPart('Tripwire/CCTP/v2/payment-escrow/v2', chainId, vault, routeId, token, guardian, input),
    encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [0, hash])]));
}
