// The first screening provider adapter (H4c3b, ADR-048): a private directory
// that an issuer integration fills with signed evidence, one file per payment,
// `<messageId>.json` holding `{ "status": "available", "head": …, "receipts": […] }`
// or a typed `{ "status": "provider-unavailable" }`. No network, URL or
// credential lives here; the operator verifies every signature itself.
// A missing file is `missing`; an unreadable, oversized or non-JSON file is an
// outage. Neither a file's text nor an error message ever becomes a reason.
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ScreeningFetch, ScreeningProvider } from '../screeningGate.js';

const MAX_EVIDENCE_BYTES = 64 * 1024;

export function screeningInbox(directory: string): ScreeningProvider {
  const dir = resolve(directory);
  return {
    fetch: async ({ messageId }): Promise<ScreeningFetch> => {
      if (!/^0x[0-9a-f]{64}$/.test(messageId)) return { status: 'provider-unavailable' };
      const file = join(dir, `${messageId}.json`);
      try {
        const info = statSync(file);
        if (!info.isFile() || info.size > MAX_EVIDENCE_BYTES) return { status: 'provider-unavailable' };
        return JSON.parse(readFileSync(file, 'utf8')) as ScreeningFetch; // The gate validates the shape strictly.
      } catch (error) {
        return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { status: 'missing' } : { status: 'provider-unavailable' };
      }
    },
  };
}
