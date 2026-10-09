// Our constructor's canonical initial policy identity; not JSON hashing.
import { encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema } from './cctp.js';

const units = z.bigint().nonnegative().max((1n << 256n) - 1n);
const configuration = z.object({ authority: cctpAddressSchema, returnRecipient: cctpAddressSchema, sourceSender: cctpAddressSchema,
  recoveryDelay: units, policy: z.object({ maxPayment: units, manualApprovalAbove: units, delayAbove: units, delaySeconds: units }).strict(),
  recipients: z.array(cctpAddressSchema).max(100),
}).strict();
export function initialPaymentPolicyHash(chainId: number, vault: Hex, routeId: Hex, token: Hex, guardian: Hex, input: unknown): Hex {
  const config = configuration.parse(input);
  const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(chainId);
  return keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'address' }, { type: 'address' },
    { type: 'tuple', components: [
      { name: 'authority', type: 'address' }, { name: 'returnRecipient', type: 'address' }, { name: 'sourceSender', type: 'address' },
      { name: 'recoveryDelay', type: 'uint256' },
      { name: 'policy', type: 'tuple', components: [{ name: 'maxPayment', type: 'uint256' }, { name: 'manualApprovalAbove', type: 'uint256' },
        { name: 'delayAbove', type: 'uint256' }, { name: 'delaySeconds', type: 'uint256' }] },
      { name: 'recipients', type: 'address[]' },
    ] },
  ], [keccak256(stringToHex('Tripwire/CCTP/v2/payment-escrow/v1')), BigInt(id), cctpAddressSchema.parse(vault), routeId,
    cctpAddressSchema.parse(token), cctpAddressSchema.parse(guardian), config]));
}
