import { keccak256, stringToHex, TransactionReceiptNotFoundError, type Chain, type PublicClient, type Transport, type Hex } from 'viem';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, CCTP_STANDARD_FINALITY, cctpEscrowAbi, cctpTransmitterAbi } from '../../../src/chains/evm/registry/cctp.js';
import { cctpHookBeneficiary, cctpReleaseId, decodeCctpMessage } from '../../../src/chains/evm/cctp.js';
import type { ContractRiskSummary, RouteBaseline } from '../../../src/tripwire/types.js';
import { CctpSourceAdapter, cctpVerifierScope, type CctpRpc } from '../cctp.js';
import { burnEventSchema } from '../events.js';
import { createRpcOperator, type RpcDestination } from './operator.js';
import { ContractEventFeed, type Clients, type TestnetConfig } from './sepolia.js';
import { assertCctpEscrowBindings } from './cctpBindings.js';
import { blockHeaderSchema } from '../finality.js';
import { rpcQuorum } from '../rpcQuorum.js';

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

/** Authenticated escrow only. Never submits burns or receives/mints. */
export async function createCctpRpcOperator(cfg: TestnetConfig, destination: Clients, deployment: RpcDestination,
  source: PublicClient<Transport, Chain>, sourceStartBlock: bigint, stateFile: string,
  locate: (messageId: Hex) => Promise<unknown | null>, opts: {
    /** 'rolling': recomputed each tick from finalized CCTP burns into this escrow (HIGH-2). */
    baseline: RouteBaseline | null | 'rolling'; baselineHours?: number;
    contractFacts?: (address: Hex) => Promise<ContractRiskSummary | null>;
    /** Independent verifier RPCs for source proofs; without them one provider is trusted. */
    verifiers?: { source?: CctpRpc[]; destination?: CctpRpc[]; quorum?: number };
  }) {
  if (deployment.route !== route.id || deployment.routeId !== keccak256(stringToHex(route.id)) ||
    deployment.chainId !== route.destination.chainId || deployment.token.toLowerCase() !== route.destination.usdc ||
    await source.getChainId() !== route.source.chainId) throw new Error('Unsupported CCTP route or USDC destination deployment.');
  if (sourceStartBlock < 0n) throw new Error('Invalid CCTP source start block.');
  const head = blockHeaderSchema.parse(await destination.pub.getBlock({ blockTag: 'finalized' }));
  await assertCctpEscrowBindings(deployment.vault, (name) => destination.pub.readContract({
    address: deployment.vault, abi: cctpEscrowAbi, functionName: name, blockNumber: head.number,
  }));
  const checked = blockHeaderSchema.parse(await destination.pub.getBlock({ blockNumber: head.number }));
  if (checked.hash !== head.hash || checked.number !== head.number) throw new Error('Finalized CCTP deployment block changed.');
  const scope = cctpVerifierScope(deployment.vault, 'authenticated-escrow');
  const { verifiers, ...operatorOpts } = opts;
  const sourceProofs = independentCctpRpc(source, verifiers?.source, verifiers?.quorum);
  const destinationProofs = independentCctpRpc(destination.pub, verifiers?.destination, verifiers?.quorum);
  return createRpcOperator(cfg, destination, deployment, stateFile, { ...operatorOpts, source: {
    chainId: route.source.chainId, address: route.source.transmitter, scope,
    create: (store) => ({ adapter: new CctpSourceAdapter(store, deployment.vault, sourceProofs, destinationProofs, locate, 'authenticated-escrow'),
      ingress: new ContractEventFeed({ pub: source, chainId: route.source.chainId }, route.source.transmitter, cctpTransmitterAbi,
        'MessageSent', sourceStartBlock, (args, timestamp, origin) => {
          if (!origin) throw new Error('CCTP source discovery requires finalized provenance.');
          // Discovery is a hint only; verify() fetches and authenticates full receipts independently.
          try {
            const message = decodeCctpMessage(args.message);
            if (message.sourceDomain !== route.source.domain || message.destinationDomain !== route.destination.domain ||
              message.sender !== route.source.messenger || message.recipient !== route.destination.messenger ||
              message.body.burnToken !== route.source.usdc || message.body.mintRecipient !== deployment.vault.toLowerCase() ||
              message.minFinalityThreshold !== CCTP_STANDARD_FINALITY || message.destinationCaller !== deployment.vault.toLowerCase()) return null;
            cctpHookBeneficiary(message.body.hookData);
            return burnEventSchema.parse({ messageId: cctpReleaseId(origin.chainId, origin.address, origin.transactionHash, origin.logIndex),
              amount: message.body.amount, timestamp });
          } catch { return null; } // Unsupported messages are held if later claimed, not silently approved.
        }, { finality: 'finalized' }) }),
  } });
}
