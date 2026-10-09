// `npm run tripwire:cctp:verify -- manifest.json [state.sqlite]` — no key or signing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCctpAudit } from './cctpAudit.js';
import { cctpManifestSchema } from './cctpManifest.js';
import { cctpPublicClients } from './cctpPublic.js';
export { cctpManifestSchema } from './cctpManifest.js';

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) { console.error('Usage: npm run tripwire:cctp:verify -- manifest.json [state.sqlite]'); process.exitCode = 1; return; }
  const manifest = cctpManifestSchema.parse(JSON.parse(readFileSync(resolve(manifestPath), 'utf8')));
  const abort = new AbortController(); const stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let audit: Awaited<ReturnType<typeof createCctpAudit>> | undefined;
  try {
    const clients = cctpPublicClients(manifest, abort.signal);
    audit = await createCctpAudit(manifest, resolve(process.argv[3] ?? `.tripwire/cctp-${manifest.vault}.sqlite`),
      clients.source, clients.destination);
    const report = await audit.tick();
    // Preserve the original verifier's output contract.
    console.log(JSON.stringify({ policy: report.policy, results: report.results.map(({ messageId, evidence }) => ({ messageId, evidence })) },
      (_k, value: unknown) => typeof value === 'bigint' ? value.toString() : value));
  } finally {
    audit?.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => { console.error('CCTP audit failed. Check manifest, deployment, RPC finality and journal scope; no transaction was sent.'); process.exitCode = 1; });
}
