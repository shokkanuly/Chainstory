// No keys, wallet clients, signing, simulation writes or transaction publication.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, http, TransactionNotFoundError, TransactionReceiptNotFoundError, type Abi, type PublicClient, type Transport } from 'viem';
import { sepolia } from 'viem/chains';
import guardian from '../../../src/tripwire/guardian.artifact.js';
import payment from './cctpPaymentEscrow.artifact.js';
import { cctpDeploymentPlan } from './cctpDeployPlan.js';
import { acceptCctpDeployment, deploymentReceiptTemplate, type DeploymentAcceptanceReader } from './cctpDeploymentAcceptance.js';
import { stringifyPublic } from './cctpPreflight.js';

export function parseAcceptanceArgs(args: readonly string[]) {
  if (args[0] === '--template' && args.length === 3 && args.slice(1).every((s) => s && !s.startsWith('--'))) {
    return { mode: 'template' as const, config: args[1], output: args[2] };
  }
  if (args.length === 3 && args.every((s) => s && !s.startsWith('--'))) return { mode: 'check' as const, config: args[0], receipts: args[1], output: args[2] };
  throw new Error('Invalid deployment acceptance arguments.');
}
async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run tripwire:cctp:accept -- config.json receipts.json new-report.json\nTemplate: npm run tripwire:cctp:accept -- --template config.json new-receipts.json'); return;
  }
  const args = parseAcceptanceArgs(process.argv.slice(2));
  const input: unknown = JSON.parse(readFileSync(resolve(args.config), 'utf8'));
  if (args.mode === 'template') {
    writeFileSync(resolve(args.output), `${stringifyPublic(deploymentReceiptTemplate(input))}\n`, { flag: 'wx', mode: 0o600 });
    console.log('Empty receipt template saved. Null entries are pending; no transaction was sent.'); return;
  }
  const receiptInput: unknown = JSON.parse(readFileSync(resolve(args.receipts), 'utf8'));
  const plan = cctpDeploymentPlan(input), controller = new AbortController();
  const abort = () => controller.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const client = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL ?? sepolia.rpcUrls.default.http[0],
      { timeout: 12_000, retryCount: 2, fetchOptions: { signal: controller.signal } }) });
    const reader = deploymentAcceptanceReader(client, plan);
    const report = await acceptCctpDeployment(input, receiptInput, reader);
    writeFileSync(resolve(args.output), `${stringifyPublic({ capturedAt: new Date().toISOString(), ...report })}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`Initial deployment acceptance: ${report.status}. Blockers: ${report.blockers.length}. No transaction sent.`);
    if (!report.initialDeploymentAccepted) process.exitCode = 2;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); controller.abort(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => { console.error('Deployment acceptance refused: package, receipt, finality, runtime, configuration, RPC or new output path failed. No accepted report or transaction produced.'); process.exitCode = 1; });
}

export function deploymentAcceptanceReader(client: PublicClient<Transport, typeof sepolia>, plan: ReturnType<typeof cctpDeploymentPlan>): DeploymentAcceptanceReader {
  return {
      getChainId: () => client.getChainId(), getBlock: (query) => client.getBlock(query),
      getTransaction: async (hash) => { try { return await client.getTransaction({ hash }); }
        catch (error) { if (error instanceof TransactionNotFoundError) return null; throw error; } },
      getReceipt: async (hash) => { try { return await client.getTransactionReceipt({ hash }); }
        catch (error) { if (error instanceof TransactionReceiptNotFoundError) return null; throw error; } },
      readCode: (address, blockNumber) => client.getCode({ address, blockNumber }),
      readVault: (functionName, blockNumber, functionArgs) => client.readContract({ address: plan.contracts.vault,
        abi: payment.abi as Abi, functionName, blockNumber, args: functionArgs }),
      readGuardian: (functionName, blockNumber, functionArgs) => client.readContract({ address: plan.contracts.guardian,
        abi: guardian.abi as Abi, functionName, blockNumber, args: functionArgs }),
      readGuardianGrants: (fromBlock, toBlock) => client.getContractEvents({ address: plan.contracts.guardian, abi: guardian.abi,
        eventName: 'ProtectedSet', fromBlock, toBlock, strict: true }),
  };
}
