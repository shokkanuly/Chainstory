import { z } from 'zod';
import { type Hex } from 'viem';
import { cctpAddressSchema } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';

export const cctpBindings = (vault: Hex) => ({
  owner: vault, transmitter: route.destination.transmitter, destinationMessenger: route.destination.messenger,
  sourceMessenger: route.source.messenger, sourceToken: route.source.usdc,
  CCTP_ESCROW_VERSION: 1, sourceDomain: route.source.domain, destinationDomain: route.destination.domain,
});
export type CctpBinding = keyof ReturnType<typeof cctpBindings>;

/** The deployment manifest remains trusted; getters are not bytecode attestation. */
export async function assertCctpEscrowBindings(vault: Hex, read: (name: CctpBinding) => Promise<unknown>): Promise<void> {
  for (const [name, expected] of Object.entries(cctpBindings(cctpAddressSchema.parse(vault)))) {
    const raw = await read(name as CctpBinding);
    const actual = typeof expected === 'string' ? cctpAddressSchema.parse(raw) :
      z.union([z.number().int().nonnegative(), z.bigint().nonnegative()]).transform((n) => BigInt(n)).parse(raw);
    if (actual !== (typeof expected === 'number' ? BigInt(expected) : expected)) throw new Error(`CCTP escrow ${name} does not match the configured route.`);
  }
}
