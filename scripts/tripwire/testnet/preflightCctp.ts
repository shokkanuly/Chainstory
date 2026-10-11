import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, http, type Hex } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import { cctpTokenReadAbi } from '../../../src/chains/evm/registry/cctp.js';
import { cctpPreflight, stringifyPublic, type PreflightReader } from './cctpPreflight.js';

interface KeylessRpc {
  getChainId(): Promise<unknown>;
  getBlock(args: { blockTag: 'latest' } | { blockNumber: bigint }): Promise<unknown>;
  getBalance(args: { address: Hex; blockNumber: bigint }): Promise<unknown>;
  getCode(args: { address: Hex; blockNumber: bigint }): Promise<unknown>;
  readContract(args: { address: Hex; abi: typeof cctpTokenReadAbi; functionName: 'decimals' | 'balanceOf'; blockNumber: bigint; args?: readonly [] | readonly [Hex] }): Promise<unknown>;
  getTransactionCount(args: { address: Hex; blockTag: 'pending' }): Promise<unknown>;
  getGasPrice(): Promise<unknown>;
  estimateGas(args: { account: Hex; data: Hex; value: bigint }): Promise<unknown>;
}
export function preflightReader(client: KeylessRpc): PreflightReader {
  return { getChainId: () => client.getChainId(), getBlock: (args) => client.getBlock(args),
    getBalance: (address, blockNumber) => client.getBalance({ address, blockNumber }),
    getCode: (address, blockNumber) => client.getCode({ address, blockNumber }).then((code) => code ?? '0x'),
    tokenRead: (address, functionName, blockNumber, account) => functionName === 'decimals'
      ? client.readContract({ address, abi: cctpTokenReadAbi, functionName, blockNumber })
      : (() => { if (!account) throw new Error('Token balance account is required.');
        return client.readContract({ address, abi: cctpTokenReadAbi, functionName, blockNumber, args: [account] }); })(),
    getPendingNonce: (address) => client.getTransactionCount({ address, blockTag: 'pending' }),
    getGasPrice: () => client.getGasPrice(), estimateCreation: (account, data) => client.estimateGas({ account, data, value: 0n }),
  };
}
async function main() {
  if (process.argv.includes('--help')) { console.log('Usage: npm run tripwire:cctp:preflight -- payment-config.json [new-report.json]'); return; }
  if (!process.argv[2] || process.argv.length > 4) throw new Error('Invalid preflight arguments.');
  const controller = new AbortController();
  const abort = () => controller.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const transport = (url: string) => http(url, { timeout: 12_000, retryCount: 2, fetchOptions: { signal: controller.signal } });
  try {
    const source = createPublicClient({ chain: baseSepolia, transport: transport(process.env.BASE_SEPOLIA_RPC_URL ?? baseSepolia.rpcUrls.default.http[0]) });
    const destination = createPublicClient({ chain: sepolia, transport: transport(process.env.SEPOLIA_RPC_URL ?? sepolia.rpcUrls.default.http[0]) });
    const report = await cctpPreflight(JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8')), preflightReader(source), preflightReader(destination));
    const text = `${stringifyPublic({ capturedAt: new Date().toISOString(), ...report })}\n`;
    if (process.argv[3]) {
      const path = resolve(process.argv[3]); writeFileSync(path, text, { flag: 'wx', mode: 0o600 });
      console.log(`Keyless preflight saved to ${path}. Checks: ${report.fundingAndNonceChecks}. Blockers: ${report.blockers.length}. No transaction sent.`);
    } else console.log(text);
    if (report.blockers.length) process.exitCode = 2;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); controller.abort(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => { console.error('Keyless preflight failed: check public configuration, RPC availability and new output path. No success report or transaction was produced.'); process.exitCode = 1; });
}
