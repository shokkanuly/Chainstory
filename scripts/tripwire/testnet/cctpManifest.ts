import { z } from 'zod';
import { cctpAddressSchema } from '../../../src/chains/evm/cctp.js';
import { screeningProfileSchema } from '../../../src/chains/evm/screening.js';
import { blockHashSchema } from '../finality.js';
import { cctpPaymentBindingsSchema, cctpProofLocatorSchema } from '../cctp.js';

const fields = { vault: cctpAddressSchema, guardian: cctpAddressSchema, operator: cctpAddressSchema };
const request = z.object({ messageId: blockHashSchema, proof: cctpProofLocatorSchema }).strict();
const unique = (m: { requests: { messageId: string }[] }) => new Set(m.requests.map((r) => r.messageId)).size === m.requests.length;
const legacy = z.object({ version: z.union([z.literal(1), z.literal(2)]), ...fields,
  requests: z.array(request).min(1).max(100),
}).strict();
const customer = z.object({ version: z.literal(3), ...fields, payment: cctpPaymentBindingsSchema,
  requests: z.array(request).min(1).max(100),
}).strict();
export const cctpManifestSchema = z.union([legacy, customer]).refine(unique, 'Duplicate request IDs.');
const pilotEscrow = z.object({ version: z.literal(2), ...fields, requests: z.array(request).max(100) }).strict();
const pilotCustomer = customer.extend({ requests: z.array(request).max(100) });
export const pilotManifestSchema = z.union([pilotEscrow, pilotCustomer]).refine(unique, 'Duplicate request IDs.');
export type CctpManifest = z.infer<typeof cctpManifestSchema>;
// Pilot may start before the first burn/mint and reload requests while watching.
export function parseAuditManifest(input: unknown, observe: boolean): CctpManifest {
  return observe ? pilotManifestSchema.parse(input) : cctpManifestSchema.parse(input);
}

/**
 * Manifest 4 (ADR-048): the screened customer escrow and the exact screening
 * profile it was accepted with (integers as canonical decimal strings). Only
 * the operator loads it; audit, observer, discovery and verify keep refusing
 * it rather than inferring a mode, and no loader infers screening from 3.
 */
export const screenedManifestSchema = z.object({ version: z.literal(4), ...fields, payment: cctpPaymentBindingsSchema,
  screening: screeningProfileSchema, requests: z.array(request).max(100),
}).strict();
export const operatorManifestSchema = z.union([pilotEscrow, pilotCustomer, screenedManifestSchema]).refine(unique, 'Duplicate request IDs.');
export type OperatorManifest = z.infer<typeof operatorManifestSchema>;
