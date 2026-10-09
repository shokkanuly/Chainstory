import { z } from 'zod';
import { cctpAddressSchema } from '../../../src/chains/evm/cctp.js';
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
export const pilotManifestSchema = z.union([z.object({ version: z.literal(2), ...fields,
  requests: z.array(request).max(100),
}).strict(), customer.extend({ requests: z.array(request).max(100) })]).refine(unique, 'Duplicate request IDs.');
export type CctpManifest = z.infer<typeof cctpManifestSchema>;
// Pilot may start before the first burn/mint and reload requests while watching.
export function parseAuditManifest(input: unknown, observe: boolean): CctpManifest {
  return observe ? pilotManifestSchema.parse(input) : cctpManifestSchema.parse(input);
}
