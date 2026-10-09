// Keyless RPC wiring. No wallet client, configuration key loader or transaction sender.
import { createPublicClient, http, TransactionReceiptNotFoundError, type Abi, type AbiEvent } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import { z } from 'zod';
import guardian from '../../../src/tripwire/guardian.artifact.js';
import { cctpEscrowAbi } from '../../../src/chains/evm/registry/cctp.js';
import type { CctpRpc } from '../cctp.js';
import type { CctpAuditReader } from './cctpAudit.js';
import type { CctpManifest } from './cctpManifest.js';
import demo from './contracts.artifact.js';
import payment from './cctpPaymentEscrow.artifact.js';
import { PAYMENT_HISTORY_BLOCK_LIMIT, paymentLifecycleEvents } from './paymentLifecycle.js';
import { rpcQuorum } from '../rpcQuorum.js';
import { rpcTransport, rpcUrls } from './rpc.js';

export const cctpRpc = (client: CctpRpc): CctpRpc => ({
  getChainId: () => client.getChainId(), getBlock: (args) => client.getBlock(args),
  getTransactionReceipt: async (args) => {
    try { return await client.getTransactionReceipt(args); }
    catch (error) { if (error instanceof TransactionReceiptNotFoundError) return null; throw error; }
  },
});
/** Extra independent endpoints from a comma-separated env value (ADR-022). */
export function verifierUrls(value: string | undefined): string[] {
  return (value ?? '').split(',').map((url) => url.trim()).filter(Boolean);
}

/**
 * The primary client alone, or a quorum over it and independently operated
 * verifier endpoints. Default quorum: every configured provider must answer and agree.
 */
export function independentCctpRpc(primary: CctpRpc, verifiers: CctpRpc[] = [], quorum?: number): CctpRpc {
  if (verifiers.length === 0) return cctpRpc(primary);
  const providers = [primary, ...verifiers].map(cctpRpc);
  return rpcQuorum(providers, { quorum: quorum ?? providers.length });
}

export function cctpPublicClients(manifest: CctpManifest, signal: AbortSignal) {
  const rpcUrl = z.string().url().refine((url) => ['http:', 'https:'].includes(new URL(url).protocol));
  // Reject malformed local transport configuration before RPC/startup retry classification.
  const urls = (value: string | undefined, fallbackUrl: string) => rpcUrls(value, fallbackUrl).map((url) => rpcUrl.parse(url));
  const sourceUrls = urls(process.env.BASE_SEPOLIA_RPC_URL, baseSepolia.rpcUrls.default.http[0]);
  const destinationUrls = urls(process.env.SEPOLIA_RPC_URL, sepolia.rpcUrls.default.http[0]);
  // Primary reads fail over across comma-separated URLs (MED-3).
  const source = createPublicClient({ chain: baseSepolia, transport: rpcTransport(sourceUrls, { signal }) });
  const destination = createPublicClient({ chain: sepolia, transport: rpcTransport(destinationUrls, { signal }) });
  // ADR-022: proof receipts and headers also go through every independent
  // verifier endpoint configured; without any, the primary provider is trusted.
  const transport = (url: string) => http(rpcUrl.parse(url), { retryCount: 3, timeout: 30_000, fetchOptions: { signal } });
  const quorum = process.env.TRIPWIRE_RPC_QUORUM ? z.coerce.number().int().positive().parse(process.env.TRIPWIRE_RPC_QUORUM) : undefined;
  const sourceProofs = independentCctpRpc(source, verifierUrls(process.env.BASE_SEPOLIA_VERIFIER_RPC_URLS)
    .map((url) => createPublicClient({ chain: baseSepolia, transport: transport(url) })), quorum);
  const destinationProofs = independentCctpRpc(destination, verifierUrls(process.env.SEPOLIA_VERIFIER_RPC_URLS)
    .map((url) => createPublicClient({ chain: sepolia, transport: transport(url) })), quorum);
  const reader: CctpAuditReader = { ...destinationProofs,
    readPaymentEvents: async (messageId, fromBlock, toBlock) => {
      if (fromBlock > toBlock || toBlock - fromBlock >= PAYMENT_HISTORY_BLOCK_LIMIT) throw new Error('Payment history scan is out of bounds.');
      const result = [];
      for (let start = fromBlock; start <= toBlock; start += 2000n) {
        const end = start + 1999n < toBlock ? start + 1999n : toBlock;
        const logs = await destination.getLogs({ address: manifest.vault, fromBlock: start, toBlock: end,
          events: paymentLifecycleEvents as readonly AbiEvent[], strict: true });
        result.push(...logs.filter((log) => log.topics[1]?.toLowerCase() === messageId));
        if (result.length > 1000) throw new Error('Payment history contains too many events.');
      }
      return result;
    },
    readCode: (address, blockNumber) => destination.getCode({ address, blockNumber }),
    readVault: (name, blockNumber, args) => destination.readContract({ address: manifest.vault,
      abi: manifest.version === 3 ? payment.abi as Abi : [...demo.ProtectedVault.abi, ...cctpEscrowAbi] as Abi, functionName: name, blockNumber, args }),
    readGuardian: (name, blockNumber, args) => destination.readContract({ address: manifest.guardian,
      abi: guardian.abi as Abi, functionName: name, blockNumber, args }),
  };
  return { source: sourceProofs, destination: reader,
    feeds: { source: { pub: source, chainId: baseSepolia.id }, destination: { pub: destination, chainId: sepolia.id } } };
}
