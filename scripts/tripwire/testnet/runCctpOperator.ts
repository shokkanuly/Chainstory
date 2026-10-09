// Operator-only CCTP queue. Does not deposit/mint, change policy, or request returns.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, http, type Chain } from 'viem';
import { baseSepolia } from 'viem/chains';
import { z } from 'zod';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { keccak256, stringToHex } from 'viem';
import { pilotManifestSchema } from './cctpManifest.js';
import { createCctpRpcOperator } from './cctpOperator.js';
import { connect, loadConfig } from './sepolia.js';

export const cctpOperatorUsage = 'Usage: npm run tripwire:cctp:operator -- manifest.json state.sqlite sourceStartBlock destinationStartBlock [--watch] [--baseline=file.json]';
export function parseCctpOperatorArgs(args: string[]) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const baseline = args.filter((a) => a.startsWith('--baseline='));
  if (positional.length !== 4 || baseline.length > 1 || args.some((a) => a.startsWith('--') && a !== '--watch' && !/^--baseline=.+$/.test(a))) throw new Error(cctpOperatorUsage);
  const block = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(BigInt);
  return { manifestPath: resolve(positional[0]), stateFile: resolve(positional[1]), sourceStartBlock: block.parse(positional[2]),
    destinationStartBlock: block.parse(positional[3]), watch: args.includes('--watch'), baselineFile: baseline[0]?.slice('--baseline='.length) };
}
const baselineSchema = z.object({ route: z.literal(route.id), computedAt: z.number().int().nonnegative(), windowHours: z.number().positive().finite(),
  sampleSize: z.number().int().positive(), medianTransferUsd: z.number().nonnegative().finite(), p95TransferUsd: z.number().nonnegative().finite(),
  rollingTvlUsd: z.number().positive().finite() }).strict();
export function parseCctpBaseline(input: unknown) { return baselineSchema.parse(input); }
const encode = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v);
async function main() {
  if (process.argv.includes('--help')) { console.log(cctpOperatorUsage); return; }
  const args = parseCctpOperatorArgs(process.argv.slice(2));
  if (!process.env.TRIPWIRE_ENV_FILE) throw new Error('Set an explicit operator key file.');
  const readManifest = () => pilotManifestSchema.parse(JSON.parse(readFileSync(args.manifestPath, 'utf8')));
  const initial = readManifest(); let active = initial;
  const identity = ({ requests: _requests, ...fields }: typeof initial) => encode(fields);
  const cfg = loadConfig();
  if (cfg.account.address.toLowerCase() !== initial.operator) throw new Error('Configured signing account differs from manifest operator.');
  const abort = new AbortController(); const stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let operator: Awaited<ReturnType<typeof createCctpRpcOperator>> | undefined;
  try {
    const source = createPublicClient({ chain: baseSepolia as Chain, transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? baseSepolia.rpcUrls.default.http[0],
      { retryCount: 3, timeout: 30_000, fetchOptions: { signal: abort.signal } }) });
    operator = await createCctpRpcOperator(cfg, await connect(cfg), {
      chainId: route.destination.chainId, route: route.id, routeId: keccak256(stringToHex(route.id)), startBlock: args.destinationStartBlock.toString(),
      vault: initial.vault, guardian: initial.guardian, token: route.destination.usdc,
    }, source, args.sourceStartBlock, args.stateFile, async (id) => active.requests.find((r) => r.messageId === id)?.proof ?? null,
    { baseline: args.baselineFile ? parseCctpBaseline(JSON.parse(readFileSync(resolve(args.baselineFile), 'utf8'))) : null,
      ...(initial.version === 3 ? { payment: initial.payment } : {}) });
    do {
      active = readManifest();
      if (identity(active) !== identity(initial)) throw new Error('Operator manifest scope changed.');
      const results = await operator.tick();
      console.log(encode({ results, outcomes: operator.store.outcomes(), quarantine: operator.watcher.quarantineReason }));
      if (operator.watcher.quarantineReason) throw new Error('Finality quarantine requires reconciliation.');
      if (!args.watch || abort.signal.aborted) break;
      await new Promise<void>((done) => {
        const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', finish); done(); };
        const timer = setTimeout(finish, 10_000); abort.signal.addEventListener('abort', finish, { once: true });
        if (abort.signal.aborted) finish();
      });
    } while (!abort.signal.aborted);
  } finally { operator?.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main().catch(() => {
  console.error('CCTP operator stopped. Check account, manifest, finalized bindings, RPC, policy and journal; preserve the journal before restarting.'); process.exitCode = 1;
});
