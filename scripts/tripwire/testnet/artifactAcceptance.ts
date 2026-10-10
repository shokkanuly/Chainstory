// Operator-only acceptance of our two concrete contracts; never a generic audit.
import { domainSeparator, keccak256, padHex, stringToHex, toHex, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema, cctpAddressWord } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { assertRuntime, reconstructRuntime } from '../../../src/chains/evm/runtime.js';
import { cctpPaymentBindingsSchema, type CctpPaymentBindings } from '../cctp.js';
import guardian from '../../../src/tripwire/guardian.artifact.js';
import payment from './cctpPaymentEscrow.artifact.js';
import screened from './cctpScreenedPaymentEscrow.artifact.js';
import acceptance from './cctpAcceptance.artifact.js';

function shortString(value: string): Hex {
  const bytes = stringToHex(value);
  const length = (bytes.length - 2) / 2;
  if (length > 31) throw new Error('Unsupported EIP-712 short string.');
  return `${padHex(bytes, { size: 31, dir: 'right' })}${toHex(length, { size: 1 }).slice(2)}` as Hex;
}
function domainWords(name: string, version: string, chainId: number, address: Hex) {
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(chainId);
  const domain = { name, version, chainId, verifyingContract: address };
  return { _cachedDomainSeparator: domainSeparator({ domain }),
    _cachedChainId: toHex(chainId, { size: 32 }), _cachedThis: cctpAddressWord(address),
    _hashedName: keccak256(stringToHex(name)), _hashedVersion: keccak256(stringToHex(version)), _name: shortString(name), _version: shortString(version) };
}
export function expectedGuardianRuntime(address: Hex, chainId: number = route.destination.chainId): Hex {
  if (acceptance.guardian.creationHash !== keccak256(guardian.bytecode)) throw new Error('Guardian acceptance artifact is stale. Recompile.');
  return reconstructRuntime(acceptance.guardian, domainWords('TripwireGuardian', '1', chainId, cctpAddressSchema.parse(address)));
}
/** Which customer escrow: the payment escrow (format 3) or its screened version (format 4, ADR-047). */
export type PaymentEscrowKind = 'payment' | 'screened';
export function expectedPaymentRuntime(vault: Hex, guardianAddress: Hex, input: CctpPaymentBindings, chainId: number = route.destination.chainId,
  bindings = { token: route.destination.usdc as Hex, routeId: keccak256(stringToHex(route.id)),
    transmitter: route.destination.transmitter as Hex, destinationMessenger: route.destination.messenger as Hex }, kind: PaymentEscrowKind = 'payment') {
  const customer = cctpPaymentBindingsSchema.parse(input);
  const [template, artifact] = kind === 'screened' ? [acceptance.screened, screened] : [acceptance.payment, payment];
  if (template.creationHash !== keccak256(artifact.bytecode)) throw new Error('Payment acceptance artifact is stale. Recompile.');
  // The screened escrow adds storage, not immutables: both share the payment escrow's constructor-patched words.
  return reconstructRuntime(template, { ...domainWords('TripwireProtectedVault', '2', chainId, vault),
    token: cctpAddressWord(bindings.token), guardian: cctpAddressWord(guardianAddress), routeId: bindings.routeId,
    transmitter: cctpAddressWord(bindings.transmitter), destinationMessenger: cctpAddressWord(bindings.destinationMessenger),
    destinationDomain: toHex(route.destination.domain, { size: 32 }), sourceDomain: toHex(route.source.domain, { size: 32 }),
    sourceMessenger: cctpAddressWord(route.source.messenger), sourceToken: cctpAddressWord(route.source.usdc),
    policyAuthority: cctpAddressWord(customer.authority), recoveryRecipient: cctpAddressWord(customer.returnRecipient),
    authorizedSourceSender: cctpAddressWord(customer.sourceSender), recoveryDelay: toHex(customer.recoveryDelay, { size: 32 }),
  });
}
export async function assertPaymentRuntime(vault: Hex, guardianAddress: Hex, customer: CctpPaymentBindings, blockNumber: bigint,
  readCode: (address: Hex, blockNumber: bigint) => Promise<unknown>, kind: PaymentEscrowKind = 'payment') {
  const guardianCode = await readCode(guardianAddress, blockNumber), paymentCode = await readCode(vault, blockNumber);
  return { guardian: assertRuntime(guardianCode, expectedGuardianRuntime(guardianAddress)),
    payment: assertRuntime(paymentCode, expectedPaymentRuntime(vault, guardianAddress, customer, undefined, undefined, kind)) };
}
