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

/**
 * Manifest 4 (ADR-048): the screened customer escrow and the exact screening
 * profile it was accepted with (integers as canonical decimal strings). The
 * operator, the keyless audit/observer and verify load it explicitly (H4c3c);
 * discovery and the plain loaders refuse it, and nothing infers screening from 3.
 */
export const screenedManifestSchema = z.object({ version: z.literal(4), ...fields, payment: cctpPaymentBindingsSchema,
  screening: screeningProfileSchema, requests: z.array(request).max(100),
}).strict();
export const operatorManifestSchema = z.union([pilotEscrow, pilotCustomer, screenedManifestSchema]).refine(unique, 'Duplicate request IDs.');
export type OperatorManifest = z.infer<typeof operatorManifestSchema>;
export type ScreenedManifest = z.infer<typeof screenedManifestSchema>;
export type AuditManifest = CctpManifest | ScreenedManifest;
/** Callers may pass an already parsed manifest back in: its profile integers return to decimal text first. */
function wire(input: unknown): unknown {
  if (!input || typeof input !== 'object' || !('screening' in input) || !input.screening || typeof input.screening !== 'object') return input;
  return { ...input, screening: Object.fromEntries(Object.entries(input.screening).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])) };
}
/** The keyless observer watches the same deployments the operator signs for (H4c3c); discovery stays manifest 3 only. */
export function parseObserverManifest(input: unknown): OperatorManifest { return operatorManifestSchema.parse(wire(input)); }
const auditScreened = screenedManifestSchema.extend({ requests: z.array(request).min(1).max(100) }).refine(unique, 'Duplicate request IDs.');
// Pilot may start before the first burn/mint and reload requests while watching.
// Manifest 4 is selected only by its own version field, never inferred.
export function parseAuditManifest(input: unknown, observe: boolean): AuditManifest {
  if (input && typeof input === 'object' && 'version' in input && input.version === 4) {
    return observe ? screenedManifestSchema.refine(unique, 'Duplicate request IDs.').parse(wire(input)) : auditScreened.parse(wire(input));
  }
  return observe ? pilotManifestSchema.parse(input) : cctpManifestSchema.parse(input);
}
