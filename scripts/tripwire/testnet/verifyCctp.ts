// `npm run tripwire:cctp:verify -- manifest.json [state.sqlite]` — no key or signing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, http, keccak256, stringToHex } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import { z } from 'zod';
import { cctpAddressSchema } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, cctpEscrowAbi } from '../../../src/chains/evm/registry/cctp.js';
import { CctpSourceAdapter, cctpProofLocatorSchema, cctpVerifierScope } from '../cctp.js';
import { blockHashSchema, blockHeaderSchema, FinalityConflictError } from '../finality.js';
import { OperatorStore } from '../store.js';
import { independentCctpRpc, verifierUrls } from './cctpOperator.js';
import { rpcTransport, rpcUrls } from './sepolia.js';
import demo from './contracts.artifact.js';
import { assertCctpEscrowBindings } from './cctpBindings.js';

export const cctpManifestSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), vault: cctpAddressSchema, guardian: cctpAddressSchema, operator: cctpAddressSchema,
  requests: z.array(z.object({ messageId: blockHashSchema, proof: cctpProofLocatorSchema }).strict()).min(1).max(100),
}).strict().refine((m) => new Set(m.requests.map((r) => r.messageId)).size === m.requests.length, 'Duplicate request IDs.');

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) { console.error('Usage: npm run tripwire:cctp:verify -- manifest.json [state.sqlite]'); process.exitCode = 1; return; }
  const manifest = cctpManifestSchema.parse(JSON.parse(readFileSync(resolve(manifestPath), 'utf8')));
  const abort = new AbortController(); const stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let store: OperatorStore | undefined;
  try {
    const transport = (url: string) => http(url, { retryCount: 3, timeout: 30_000, fetchOptions: { signal: abort.signal } });
    // Primary reads fail over across comma-separated URLs (MED-3); proofs still need the independent verifiers below.
    const source = createPublicClient({ chain: baseSepolia, transport: rpcTransport(rpcUrls(process.env.BASE_SEPOLIA_RPC_URL, baseSepolia.rpcUrls.default.http[0]), { signal: abort.signal }) });
    const destination = createPublicClient({ chain: sepolia, transport: rpcTransport(rpcUrls(process.env.SEPOLIA_RPC_URL, sepolia.rpcUrls.default.http[0]), { signal: abort.signal }) });
    // ADR-022: proofs are read through every independent verifier endpoint configured.
    const quorum = process.env.TRIPWIRE_RPC_QUORUM ? Number(process.env.TRIPWIRE_RPC_QUORUM) : undefined;
    const sourceProofs = independentCctpRpc(source, verifierUrls(process.env.BASE_SEPOLIA_VERIFIER_RPC_URLS)
      .map((url) => createPublicClient({ chain: baseSepolia, transport: transport(url) })), quorum);
    const destinationProofs = independentCctpRpc(destination, verifierUrls(process.env.SEPOLIA_VERIFIER_RPC_URLS)
      .map((url) => createPublicClient({ chain: sepolia, transport: transport(url) })), quorum);
    if (await source.getChainId() !== route.source.chainId || await destination.getChainId() !== route.destination.chainId) throw new Error('RPC chain identity does not match the CCTP route.');
    const head = blockHeaderSchema.parse(await destination.getBlock({ blockTag: 'finalized' }));
    const policy = manifest.version === 2 ? 'authenticated-escrow' : 'legacy-post-mint';
    if (manifest.version === 2) await assertCctpEscrowBindings(manifest.vault, (name) => destination.readContract({
      address: manifest.vault, abi: cctpEscrowAbi, functionName: name, blockNumber: head.number,
    }));
    await destination.readContract({ address: manifest.vault, abi: demo.ProtectedVault.abi, functionName: 'MAX_REVIEW_TTL', blockNumber: head.number });
    for (const [name, expected] of [['token', route.destination.usdc], ['guardian', manifest.guardian], ['routeId', keccak256(stringToHex(route.id))]] as const) {
      const actual = await destination.readContract({ address: manifest.vault, abi: demo.ProtectedVault.abi, functionName: name, blockNumber: head.number });
      if (typeof actual !== 'string' || actual.toLowerCase() !== expected) throw new Error(`Vault ${name} does not match the CCTP escrow deployment.`);
    }
    const path = resolve(process.argv[3] ?? `.tripwire/cctp-${manifest.vault}.sqlite`);
    store = new OperatorStore(path, { route: route.id, sourceChainId: route.source.chainId, chainId: route.destination.chainId,
      source: route.source.transmitter, vault: manifest.vault, guardian: manifest.guardian, token: route.destination.usdc,
      sender: manifest.operator, decimals: route.decimals, finalityMode: 'finalized', sourceVerifier: cctpVerifierScope(manifest.vault, policy) });
    if (store.loadWatcher()?.quarantine || store.sourceQuarantine()) throw new Error('This operator is quarantined; reconcile it before auditing new proof claims.');
    const adapter = new CctpSourceAdapter(store, manifest.vault, sourceProofs, destinationProofs,
      async (id) => manifest.requests.find((request) => request.messageId === id)?.proof ?? null, policy);
    const tuple = z.tuple([cctpAddressSchema, z.bigint().positive(), z.number().int().min(0).max(4), z.bigint(), cctpAddressSchema, z.bigint(), z.number()]);
    const results = [];
    for (const request of manifest.requests) {
      const release = tuple.parse(await destination.readContract({ address: manifest.vault, abi: demo.ProtectedVault.abi,
        functionName: 'releases', args: [request.messageId], blockNumber: head.number }));
      const checked = blockHeaderSchema.parse(await destination.getBlock({ blockNumber: head.number }));
      if (checked.number !== head.number || checked.hash !== head.hash) {
        store.quarantineSource('Finalized CCTP escrow state block changed during audit.');
        throw new FinalityConflictError('Finalized CCTP escrow state block changed during audit.');
      }
      const evidence = await adapter.verify({ messageId: request.messageId, recipient: release[0], amount: release[1], timestamp: Number(head.timestamp) });
      results.push({ messageId: request.messageId, evidence });
    }
    await adapter.assertCanonical();
    console.log(JSON.stringify({ policy, results }, (_k, value: unknown) => typeof value === 'bigint' ? value.toString() : value));
  } finally {
    store?.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}

// Importing the manifest schema for tests must not run the CLI.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => { console.error('CCTP audit failed. Check manifest, deployment, RPC finality and journal scope; no transaction was sent.'); process.exitCode = 1; });
}
