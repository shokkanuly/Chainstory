// Actual subprocess drill, with serialized synthetic RPC vectors from the test parent.
// This file is never used by the production supervisor and never imports Vitest or keys.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HttpRequestError } from 'viem';
import type { CctpAuditReader } from '../../testnet/cctpAudit.js';
import type { CctpRpc } from '../../cctp.js';
import type { EventFeedClient } from '../../testnet/sepolia.js';
import { OperatorStore } from '../../store.js';
import { runObserveCommand } from '../../testnet/observeCctp.js';
import { createCctpAudit } from '../../testnet/cctpAudit.js';

const [directory, scenario, ...argv] = process.argv.slice(2);
type Header = { number: bigint; hash: `0x${string}`; parentHash: `0x${string}`; timestamp: bigint };
type Snapshot = { sourceReceipt: Awaited<ReturnType<CctpRpc['getTransactionReceipt']>>;
  destinationReceipt: Awaited<ReturnType<CctpRpc['getTransactionReceipt']>>;
  sourceBlocks: Header[]; destinationBlocks: Header[];
  sourceEvents: Record<string, unknown>[];
  destinationEvents: Record<string, unknown>[];
  facts: Record<string, unknown>; guardianFacts: Record<string, unknown>; vault: string; guardian: string; vaultCode: `0x${string}`; guardianCode: `0x${string}` };
const data: Snapshot = JSON.parse(readFileSync(join(directory, 'rpc.json'), 'utf8'), (_k, v: unknown) =>
  v && typeof v === 'object' && '$bigint' in v ? BigInt(String(v.$bigint)) : v);
const counter = join(directory, 'attempts.txt');
const attempt = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) + 1 : 1;
writeFileSync(counter, String(attempt));
const first = attempt === 1;
const abort = new AbortController();
process.once('SIGTERM', () => abort.abort()); process.once('SIGINT', () => abort.abort());
const make = (source: boolean): CctpRpc => ({
  getChainId: async () => {
    if (first && scenario === 'rpc-outage') throw new HttpRequestError({ url: 'https://rpc.invalid/REDACTION_SENTINEL', status: 503 });
    return source ? 84532 : 11155111;
  },
  getBlock: async (args) => {
    const blocks = source ? data.sourceBlocks : data.destinationBlocks;
    const block = 'blockNumber' in args ? blocks.find((b) => b.number === args.blockNumber) : blocks[blocks.length - 1];
    if (!block) throw new Error('Synthetic missing block.'); return block;
  },
  getTransactionReceipt: async () => source ? data.sourceReceipt : data.destinationReceipt,
});
const source = make(true), destination: CctpAuditReader = { ...make(false),
  readCode: async (address) => address === data.guardian ? data.guardianCode : data.vaultCode,
  readVault: async (name) => data.facts[name], readGuardian: async (name) => data.guardianFacts[name],
};
const pub = (isSource: boolean): EventFeedClient['pub'] & Pick<CctpRpc, 'getChainId'> => ({ ...make(isSource),
  getBlockNumber: async () => isSource ? 101n : 201n,
  getContractEvents: async ({ fromBlock, toBlock }) => (isSource ? data.sourceEvents : data.destinationEvents)
    .filter((event) => typeof event.blockNumber === 'bigint' && event.blockNumber >= fromBlock && event.blockNumber <= toBlock),
});
if (first && scenario === 'quarantine') {
  const audit = await createCctpAudit(JSON.parse(readFileSync(argv[0], 'utf8')), argv[1], source, destination, true);
  audit.store.quarantineSource('Synthetic finalized conflict REDACTION_SENTINEL'); audit.close();
}
if (first && scenario === 'crash-before-publication') {
  const save = OperatorStore.prototype.saveDiscovery;
  OperatorStore.prototype.saveDiscovery = function (state) { save.call(this, state); process.kill(process.pid, 'SIGKILL'); };
}
if (first && scenario === 'journal-after-commit') {
  const save = OperatorStore.prototype.saveDiscovery;
  OperatorStore.prototype.saveDiscovery = function (state) { save.call(this, state); throw new Error('REDACTION_SENTINEL disk fault'); };
}
const result = await runObserveCommand(argv, abort.signal, {
  clients: () => ({ source, destination, feeds: { source: { chainId: 84532, pub: pub(true) }, destination: { chainId: 11155111, pub: pub(false) } } }),
  output: (report) => {
    writeFileSync(join(directory, 'published.txt'), 'synthetic');
    if (first && scenario === 'crash-after-publication') process.kill(process.pid, 'SIGKILL');
    if (scenario !== 'wait-for-signal' && report && typeof report === 'object' && 'status' in report && report.status === 'ok') abort.abort();
  },
});
if (result.diagnostic) console.error(JSON.stringify(result.diagnostic));
console.error('Discard this raw warning https://user:REDACTION_SENTINEL@rpc.invalid/?key=REDACTION_SENTINEL');
process.exitCode = result.exitCode;
