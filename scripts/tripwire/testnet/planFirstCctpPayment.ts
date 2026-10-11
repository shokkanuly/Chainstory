// Public RPC only. No private env loader, wallet client, signature or send method.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, http, type Abi, type PublicClient, type Transport } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import { z } from 'zod';
import { cctpTokenReadAbi, cctpMessengerBurnAbi, CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from '../../../src/chains/evm/registry/cctp.js';
import { blockHeaderSchema } from '../finality.js';
import { deploymentAcceptanceReader } from './acceptCctpDeployment.js';
import { cctpDeploymentPlan, cctpPaymentDeploymentSchema } from './cctpDeployPlan.js';
import { firstPaymentRequestSchema, prepareFirstPayment, type FirstPaymentSource } from './cctpFirstPayment.js';
import { stringifyPublic } from './cctpPreflight.js';

export function parseFirstPaymentArgs(args: readonly string[]) {
  if (args[0] === '--intent' && args.length === 3 && args.slice(1).every((s) => s && !s.startsWith('--'))) {
    return { mode: 'intent' as const, config: args[1], output: args[2] };
  }
  if (args.length === 4 && args.every((s) => s && !s.startsWith('--'))) {
    return { mode: 'prepare' as const, config: args[0], receipts: args[1], intent: args[2], output: args[3] };
  }
  throw new Error('Invalid first-payment arguments.');
}
export function firstPaymentSource(client: PublicClient<Transport, typeof baseSepolia>): FirstPaymentSource {
  return { getChainId: () => client.getChainId(), getBlock: (query) => client.getBlock(query),
    getBalance: (address, blockNumber) => client.getBalance({ address, blockNumber }),
    getCode: (address, blockNumber) => client.getCode({ address, blockNumber }).then((code) => code ?? '0x'),
    readToken: (functionName, blockNumber, args) => client.readContract({ address: route.source.usdc, abi: cctpTokenReadAbi as Abi, functionName, blockNumber, args }),
    readMessenger: (functionName, blockNumber, args) => client.readContract({ address: route.source.messenger, abi: cctpMessengerBurnAbi as Abi, functionName, blockNumber, args }),
    getNonce: (address, block) => client.getTransactionCount({ address, ...(block === 'pending' ? { blockTag: 'pending' as const } : { blockNumber: block }) }),
    simulate: async (account, to, data, blockNumber) => (await client.call({ account, to, data, blockNumber, value: 0n })).data ?? '0x',
    estimate: (account, to, data, blockNumber) => client.estimateGas({ account, to, data, blockNumber, value: 0n }),
  };
}
// The default is a selected tiny test payment, not a protocol fee quote.
export async function createFirstPaymentIntent(input: unknown, operationId: string, source: FirstPaymentSource) {
  const config = cctpPaymentDeploymentSchema.parse(input);
  const currentNonceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 2);
  if (z.number().int().parse(await source.getChainId()) !== route.source.chainId) throw new Error('Intent RPC is not Base Sepolia.');
  const head = blockHeaderSchema.parse(await source.getBlock({ blockTag: 'latest' }));
  const current = currentNonceSchema.parse(await source.getNonce(config.payment.sourceSender, head.number));
  if (currentNonceSchema.parse(await source.getNonce(config.payment.sourceSender, 'pending')) !== current) throw new Error('Source has pending transactions; reconcile before creating an intent.');
  const allowance = z.bigint().nonnegative().max((1n << 256n) - 1n).parse(await source.readToken('allowance', head.number,
    [config.payment.sourceSender, route.source.messenger]));
  const amount = 1_000_000n;
  const reserved = BigInt(current) + (allowance === amount ? 0n : allowance === 0n ? 1n : 2n);
  const request = firstPaymentRequestSchema.parse({ version: 1, grossBurnBaseUnits: amount.toString(), maxFeeBaseUnits: '1000',
    recipient: config.payment.recipients[0], operationId, reservedBurnNonce: reserved.toString() });
  const check = blockHeaderSchema.parse(await source.getBlock({ blockNumber: head.number }));
  if (check.number !== head.number || check.hash !== head.hash || check.timestamp !== head.timestamp ||
    currentNonceSchema.parse(await source.getNonce(config.payment.sourceSender, 'pending')) !== current) throw new Error('Intent snapshot or nonce changed.');
  return request;
}
async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run tripwire:cctp:payment -- config.json receipts.json intent.json new-report.json\nNew intent: npm run tripwire:cctp:payment -- --intent config.json new-intent.json\nDefault: gross 1 test USDC, max Circle fee 0.001 USDC, first configured recipient. Reuse the same intent after each recorded successful approval. No signing or sending.'); return;
  }
  const args = parseFirstPaymentArgs(process.argv.slice(2));
  const input: unknown = JSON.parse(readFileSync(resolve(args.config), 'utf8'));
  const plan = cctpDeploymentPlan(input), controller = new AbortController();
  const abort = () => controller.abort(); process.once('SIGINT', abort); process.once('SIGTERM', abort);
  const transport = (url: string) => http(url, { timeout: 12_000, retryCount: 2, fetchOptions: { signal: controller.signal } });
  try {
    const source = firstPaymentSource(createPublicClient({ chain: baseSepolia, transport: transport(process.env.BASE_SEPOLIA_RPC_URL ?? baseSepolia.rpcUrls.default.http[0]) }));
    if (args.mode === 'intent') {
      const intent = await createFirstPaymentIntent(input, `0x${randomBytes(32).toString('hex')}`, source);
      writeFileSync(resolve(args.output), `${stringifyPublic(intent)}\n`, { flag: 'wx', mode: 0o600 });
      console.log('New public intent saved: gross 1 test USDC, selected fee cap 0.001 USDC. This is not a fee quote or authorization; reuse this file, never replace it after submission.'); return;
    }
    const receipts: unknown = JSON.parse(readFileSync(resolve(args.receipts), 'utf8'));
    const intent: unknown = JSON.parse(readFileSync(resolve(args.intent), 'utf8'));
    const destination = createPublicClient({ chain: sepolia, transport: transport(process.env.SEPOLIA_RPC_URL ?? sepolia.rpcUrls.default.http[0]) });
    const report = await prepareFirstPayment(input, receipts, intent, source, { ...deploymentAcceptanceReader(destination, plan),
      getLatestBlock: () => destination.getBlock({ blockTag: 'latest' }), getBalance: (address, blockNumber) => destination.getBalance({ address, blockNumber }) });
    writeFileSync(resolve(args.output), `${stringifyPublic({ capturedAt: new Date().toISOString(), ...report })}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`First payment: ${report.status}. Blockers: ${report.blockers.length}. No transaction signed or sent.`);
    if (report.status === 'blocked') process.exitCode = 2;
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); controller.abort(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch(() => { console.error('First-payment preparation refused: public input, deployment, current state, fee, simulation, RPC or new output path failed. No transaction sent.'); process.exitCode = 1; });
}
