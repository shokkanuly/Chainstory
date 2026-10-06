// Automatic proof locators are hints. The existing audit still authenticates receipts.
import { keccak256, stringToHex, type Hex } from 'viem';
import { z } from 'zod';
import { cctpAddressSchema, decodeCctpMessage, decodeCctpPaymentHook } from '../../../src/chains/evm/cctp.js';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route, CCTP_STANDARD_FINALITY, cctpTransmitterAbi } from '../../../src/chains/evm/registry/cctp.js';
import { discoveryStateSchema, type DiscoveryState, type SourceHint, type DestinationHint } from '../discoveryState.js';
import { blockHeaderSchema, blockHashSchema, finalizedCheckpointSchema, FinalityConflictError } from '../finality.js';
import { pilotManifestSchema } from './cctpManifest.js';
import { ContractEventFeed, type EventFeedClient } from './sepolia.js';
import paymentArtifact from './cctpPaymentEscrow.artifact.js';

export const DISCOVERY_BLOCK_LIMIT = 4096n;
export class DiscoveryStoppedError extends Error {
  constructor(message: string) { super(message); this.name = 'DiscoveryStoppedError'; }
}
const nonzeroHash = blockHashSchema.refine((v) => !/^0x0{64}$/.test(v));
const boundSchema = z.object({ messageId: nonzeroHash, operationId: nonzeroHash,
  returnRecipient: cctpAddressSchema, intentPolicyHash: nonzeroHash });
type Header = z.infer<typeof blockHeaderSchema>;
export interface DiscoveryCoverage {
  version: 1 | 2; mode: 'bounded-finalized-hints' | 'persistent-finalized-hints'; hintOnly: true;
  incremental?: { resumed: boolean; sourceFrom: bigint; destinationFrom: bigint; sourceHead: Header; destinationHead: Header };
  source: { from: bigint; through: Header }; destination: { from: bigint; through: Header };
  counts: { sourceHints: number; destinationHints: number; paired: number };
  pendingSource: { operationId: Hex; transactionHash: Hex; logIndex: number }[];
  unmatchedDestination: { operationId: Hex; messageId: Hex; transactionHash: Hex; reason: 'source-not-in-range' | 'ambiguous-operation' | 'intent-mismatch' }[];
  conflicts: Hex[];
}

export async function discoverCctpRequests(input: unknown, clients: {
  source: EventFeedClient & { pub: EventFeedClient['pub'] & { getChainId(): Promise<unknown> } };
  destination: EventFeedClient & { pub: EventFeedClient['pub'] & { getChainId(): Promise<unknown> } };
}, starts: { source: bigint; destination: bigint }, signal: AbortSignal, persistent?: { resume: DiscoveryState | null }) {
  const manifest = pilotManifestSchema.parse(input);
  if (signal.aborted) throw new Error('Discovery canceled.');
  if (manifest.version !== 3 || manifest.requests.length) throw new DiscoveryStoppedError('Discovery requires an empty customer-payment manifest. Manual requests remain a separate mode.');
  const fingerprint = keccak256(stringToHex(JSON.stringify(manifest, (_key, v: unknown) => typeof v === 'bigint' ? v.toString() : v)));
  const previous = persistent?.resume ? discoveryStateSchema.parse(persistent.resume) : null;
  if (previous && (previous.fingerprint !== fingerprint || previous.source.from !== starts.source || previous.destination.from !== starts.destination)) throw new DiscoveryStoppedError('Discovery manifest or initial bounds differ from the journal.');
  const next = { source: previous ? previous.source.through.number + 1n : starts.source,
    destination: previous ? previous.destination.through.number + 1n : starts.destination };
  if (clients.source.chainId !== route.source.chainId || clients.destination.chainId !== route.destination.chainId ||
    await clients.source.pub.getChainId() !== route.source.chainId || await clients.destination.pub.getChainId() !== route.destination.chainId) throw new DiscoveryStoppedError('Discovery chain identity differs from the configured route.');
  const [sourceHead, destinationHead] = await Promise.all([clients.source.pub.getBlock({ blockTag: 'finalized' }), clients.destination.pub.getBlock({ blockTag: 'finalized' })]);
  const heads = { source: blockHeaderSchema.parse(sourceHead), destination: blockHeaderSchema.parse(destinationHead) };
  for (const side of ['source', 'destination'] as const) {
    const start = next[side], head = heads[side];
    if (start < 0n || (!previous && start > head.number) || (!persistent && head.number - start >= DISCOVERY_BLOCK_LIMIT)) throw new DiscoveryStoppedError('Discovery range must cover 1–4096 finalized blocks on each chain (zero new blocks allowed on resume).');
    if (previous && start > head.number + 1n) throw new Error('Finalized RPC is behind the saved discovery cursor.');
  }
  const through = async (side: 'source' | 'destination') => {
    const head = heads[side], cap = next[side] + DISCOVERY_BLOCK_LIMIT - 1n;
    if (!persistent || cap >= head.number) return head;
    const endpoint = blockHeaderSchema.parse(await clients[side].pub.getBlock({ blockNumber: cap }));
    if (endpoint.number !== cap || endpoint.timestamp > head.timestamp) throw new Error('Discovery bounded endpoint differs from finalized history.');
    return endpoint;
  };
  const [source, destination] = await Promise.all([through('source'), through('destination')]);
  const sourceFeed = new ContractEventFeed<SourceHint>(clients.source, route.source.transmitter, cctpTransmitterAbi,
    'MessageSent', starts.source, (args, _time, origin) => {
      if (!origin) throw new Error('Source discovery lacks finalized provenance.');
      let message: ReturnType<typeof decodeCctpMessage>, intent: ReturnType<typeof decodeCctpPaymentHook>;
      try { message = decodeCctpMessage(args.message); intent = decodeCctpPaymentHook(message.body.hookData); }
      catch { return null; } // Unrelated/unsupported messages are never approval evidence.
      if (message.sourceDomain !== route.source.domain || message.destinationDomain !== route.destination.domain ||
        message.sender !== route.source.messenger || message.recipient !== route.destination.messenger ||
        message.body.burnToken !== route.source.usdc || message.body.mintRecipient !== manifest.vault ||
        message.destinationCaller !== manifest.vault || message.minFinalityThreshold !== CCTP_STANDARD_FINALITY ||
        message.body.messageSender !== manifest.payment.sourceSender || intent.returnRecipient !== manifest.payment.returnRecipient) return null;
      return { operationId: intent.operationId, policyHash: intent.policyHash, returnRecipient: intent.returnRecipient, origin };
    }, { finality: 'finalized', until: source.number });
  const destinationFeed = new ContractEventFeed<DestinationHint>(clients.destination, manifest.vault, paymentArtifact.abi,
    'PaymentCreditBound', starts.destination, (args, _time, origin) => {
      if (!origin) throw new Error('Destination discovery lacks finalized provenance.');
      return { ...boundSchema.parse(args), origin };
    }, { finality: 'finalized', until: destination.number });
  if (previous) { sourceFeed.restore(previous.source.checkpoint); destinationFeed.restore(previous.destination.checkpoint); }
  const assertSaved = async () => {
    if (!previous) return;
    for (const [client, range, rows] of [[clients.source, previous.source, previous.burns], [clients.destination, previous.destination, previous.credits]] as const) {
      const blocks = new Map(rows.map((h) => [h.origin.blockNumber, { hash: h.origin.blockHash }]));
      blocks.set(range.through.number, { hash: range.through.hash });
      for (const [number, expected] of blocks) {
        if (signal.aborted) throw new Error('Discovery canceled.');
        const block = blockHeaderSchema.parse(await client.pub.getBlock({ blockNumber: number }));
        if (block.number !== number || block.hash !== expected.hash || (number === range.through.number && block.timestamp !== range.through.timestamp)) throw new FinalityConflictError('Persisted discovery history changed.');
      }
    }
  };
  await sourceFeed.assertCanonical(); await destinationFeed.assertCanonical(); await assertSaved();
  let peerFailed = false;
  let firstFailure: { error: unknown } | undefined;
  const collect = async <T>(feed: ContractEventFeed<T>, through: bigint) => {
    const hints: T[] = [];
    while (BigInt(finalizedCheckpointSchema.parse(JSON.parse(feed.checkpoint())).next) <= through) {
      if (signal.aborted || peerFailed) throw new Error('Discovery canceled.');
      const before = feed.checkpoint(); hints.push(...await feed.poll());
      if (hints.length > 100) throw new DiscoveryStoppedError('Discovery exceeds 100 candidate events; narrow the range.');
      if (feed.checkpoint() === before) throw new Error('Discovery finalized RPC is behind its pinned range.');
    }
    await feed.assertCanonical(); return hints;
  };
  const guarded = async <T>(run: Promise<T>) => { try { return await run; } catch (error) { firstFailure ??= { error }; peerFailed = true; throw error; } };
  const collected = await Promise.allSettled([guarded(collect(sourceFeed, source.number)), guarded(collect(destinationFeed, destination.number))]);
  const [sourceResult, destinationResult] = collected;
  if (firstFailure) throw firstFailure.error;
  if (sourceResult.status === 'rejected') throw sourceResult.reason;
  if (destinationResult.status === 'rejected') throw destinationResult.reason;
  const burns = [...(previous?.burns ?? []), ...sourceResult.value], credits = [...(previous?.credits ?? []), ...destinationResult.value];
  if (burns.length > 100 || credits.length > 100) throw new DiscoveryStoppedError('Discovery journal capacity reached (100 hints per chain); reconcile without resetting its cursor.');
  const groups = <T extends { operationId: Hex }>(rows: T[]) => {
    const map = new Map<Hex, T[]>(); for (const row of rows) map.set(row.operationId, [...(map.get(row.operationId) ?? []), row]); return map;
  };
  const sources = groups(burns), destinations = groups(credits), conflicts = new Set<Hex>();
  for (const [id, rows] of [...sources, ...destinations]) if (rows.length > 1) conflicts.add(id);
  const metadata: DiscoveryCoverage = { version: persistent ? 2 : 1, mode: persistent ? 'persistent-finalized-hints' : 'bounded-finalized-hints', hintOnly: true,
    ...(persistent ? { incremental: { resumed: Boolean(previous), sourceFrom: next.source, destinationFrom: next.destination, sourceHead: heads.source, destinationHead: heads.destination } } : {}),
    source: { from: starts.source, through: source }, destination: { from: starts.destination, through: destination },
    counts: { sourceHints: burns.length, destinationHints: credits.length, paired: 0 }, conflicts: [...conflicts].sort(),
    pendingSource: [], unmatchedDestination: [] };
  const requests: typeof manifest.requests = [];
  for (const credit of credits) {
    const matches = sources.get(credit.operationId), burn = matches?.[0];
    const reason = conflicts.has(credit.operationId) ? 'ambiguous-operation' : !burn ? 'source-not-in-range'
      : burn.returnRecipient !== credit.returnRecipient || burn.policyHash !== credit.intentPolicyHash ? 'intent-mismatch' : undefined;
    if (reason || !burn) { metadata.unmatchedDestination.push({ operationId: credit.operationId, messageId: credit.messageId,
      transactionHash: credit.origin.transactionHash, reason: reason ?? 'source-not-in-range' }); continue; }
    requests.push({ messageId: credit.messageId, proof: { sourceTransactionHash: burn.origin.transactionHash,
      sourceLogIndex: burn.origin.logIndex, destinationTransactionHash: credit.origin.transactionHash } });
  }
  for (const burn of burns) if (!destinations.has(burn.operationId) && !conflicts.has(burn.operationId)) metadata.pendingSource.push({
    operationId: burn.operationId, transactionHash: burn.origin.transactionHash, logIndex: burn.origin.logIndex });
  metadata.counts.paired = requests.length;
  // Close both complete ranges against their captured hashes/clocks before export.
  const assertSnapshots = async () => {
    for (const [client, head] of [[clients.source, source], [clients.destination, destination], [clients.source, heads.source], [clients.destination, heads.destination]] as const) {
      if (signal.aborted) throw new Error('Discovery canceled.');
      const now = blockHeaderSchema.parse(await client.pub.getBlock({ blockNumber: head.number }));
      if (now.number !== head.number || now.hash !== head.hash || now.timestamp !== head.timestamp) throw new FinalityConflictError('Discovery snapshot changed.');
    }
  };
  await assertSnapshots();
  await sourceFeed.assertCanonical(); await destinationFeed.assertCanonical(); await assertSaved();
  const state = persistent ? discoveryStateSchema.parse({ version: 1, fingerprint,
    source: { ...metadata.source, checkpoint: sourceFeed.checkpoint() },
    destination: { ...metadata.destination, checkpoint: destinationFeed.checkpoint() }, burns, credits }) : undefined;
  // Schema validation also rejects duplicate IDs; no caller receives a partial manifest.
  return { manifest: pilotManifestSchema.parse({ ...manifest, requests }), metadata, state,
    assertCanonical: async () => { await sourceFeed.assertCanonical(); await destinationFeed.assertCanonical(); await assertSnapshots(); await assertSaved(); } };
}
