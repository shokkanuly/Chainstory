// Untrusted public-file boundary. Does not fetch, authenticate receipts or send.
import { z } from 'zod';
import { baseSepolia, sepolia } from 'viem/chains';
import { cctpAddressSchema } from './cctp';
import { CCTP_BASE_SEPOLIA_TO_SEPOLIA as route } from './registry/cctp';
import { cleanDisplayText, type OperationsSnapshot, type OperationsPayment } from '../../domain/operations';
import { behavioralAdvisorySchema } from '../../domain/behavioralShadow';
const uint = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).transform(BigInt).refine((v) => v < (1n << 256n));
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/).transform((v) => v.toLowerCase());
const nonzeroHash = hash.refine((v) => !/^0x0{64}$/.test(v));
const time = uint.refine((v) => v <= 253402300799n);
const text = z.string().min(1).max(2048).transform(cleanDisplayText);
const texts = z.array(text).max(100);
const block = z.object({ number: uint, hash, timestamp: time });
const routeField = z.literal(route.id);
const hintCount = z.number().int().min(0).max(100);
const worker = z.object({ version: z.literal(1), state: z.enum(['scheduled', 'retrying', 'stopped']),
  attempt: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), consecutiveFailures: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  intervalSeconds: z.number().int().min(5).max(300), nextPollSeconds: z.number().int().min(0).max(300),
}).strict().refine((w) => w.consecutiveFailures <= w.attempt && (w.state === 'scheduled'
  ? w.consecutiveFailures === 0 && w.nextPollSeconds === w.intervalSeconds
  : w.consecutiveFailures > 0 && (w.state === 'stopped' ? w.nextPollSeconds === 0
    : w.nextPollSeconds === Math.min(300, w.intervalSeconds * 2 ** Math.min(w.consecutiveFailures - 1, 6)))));
const coverageRange = z.object({ from: uint, through: block }).refine((r) => r.from <= r.through.number);
const discoveryRange = coverageRange.refine((r) => r.through.number - r.from < 4096n);
const discoveryFields = { hintOnly: z.literal(true),
  counts: z.object({ sourceHints: hintCount, destinationHints: hintCount, paired: hintCount }),
  pendingSource: z.array(z.object({ operationId: nonzeroHash, transactionHash: hash, logIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(100),
  unmatchedDestination: z.array(z.object({ operationId: nonzeroHash, messageId: nonzeroHash, transactionHash: hash,
    reason: z.enum(['source-not-in-range', 'ambiguous-operation', 'intent-mismatch']) })).max(100), conflicts: z.array(nonzeroHash).max(100),
};
const discovery = z.discriminatedUnion('version', [
  z.object({ version: z.literal(1), mode: z.literal('bounded-finalized-hints'), source: discoveryRange, destination: discoveryRange, ...discoveryFields }),
  z.object({ version: z.literal(2), mode: z.literal('persistent-finalized-hints'), source: coverageRange, destination: coverageRange,
    incremental: z.object({ resumed: z.boolean(), sourceFrom: uint, destinationFrom: uint, sourceHead: block, destinationHead: block }), ...discoveryFields }),
]).refine((d) => (d.version !== 2 || (['source', 'destination'] as const).every((side) => {
  const start = side === 'source' ? d.incremental.sourceFrom : d.incremental.destinationFrom, r = d[side];
  const head = side === 'source' ? d.incremental.sourceHead : d.incremental.destinationHead;
  return start >= r.from && start <= r.through.number + (d.incremental.resumed ? 1n : 0n) && r.through.number - start < 4096n &&
    (d.incremental.resumed || start === r.from) && head.number >= r.through.number && head.timestamp >= r.through.timestamp &&
    (head.number !== r.through.number || (head.hash === r.through.hash && head.timestamp === r.through.timestamp));
})) && d.counts.destinationHints === d.counts.paired + d.unmatchedDestination.length &&
  d.counts.sourceHints >= d.counts.paired + d.pendingSource.length && new Set(d.conflicts).size === d.conflicts.length &&
  new Set(d.pendingSource.map((p) => p.operationId)).size === d.pendingSource.length && !d.pendingSource.some((p) => d.conflicts.includes(p.operationId)) &&
  d.unmatchedDestination.every((h) => (h.reason === 'ambiguous-operation') === d.conflicts.includes(h.operationId)));
const envelope = { version: z.literal(1), enforcement: z.literal(false) };
const readiness = z.object({ ...envelope, mode: z.literal('keyless-predeployment'), route: routeField, capturedAt: z.string().datetime(),
  submittedTransactions: z.literal(0), packageHash: hash, predicted: z.object({ guardian: cctpAddressSchema, vault: cctpAddressSchema }),
  snapshots: z.object({ source: block, destination: block }),
  accounts: z.array(z.object({ chainId: z.union([z.literal(route.source.chainId), z.literal(route.destination.chainId)]), address: cctpAddressSchema,
    roles: z.array(text).min(1).max(8), ethWei: uint })).min(1).max(12), sourceUsdcBaseUnits: uint,
  fundingAndNonceChecks: z.enum(['blocked', 'passed']), blockers: texts, remainingGates: texts,
}).refine((r) => (r.blockers.length === 0) === (r.fundingAndNonceChecks === 'passed'));
const evidence = z.discriminatedUnion('status', [z.object({ status: z.literal('verified'), amount: uint.refine((v) => v > 0n) }),
  ...(['pending', 'invalid', 'unavailable'] as const).map((status) => z.object({ status: z.literal(status), reason: text }))]);
const payment = z.object({ version: uint.refine((v) => v > 0n), hash, reviewedVersion: uint, returnAt: time, returned: z.boolean(), now: time,
  blockers: z.array(z.enum(['paused', 'recipient', 'amount', 'approval'])).max(4) });
const proof = z.object({ sourceTransactionHash: hash, destinationTransactionHash: hash, sourceBlock: uint, destinationBlock: uint,
  sourceBlockHash: hash, destinationBlockHash: hash, operationId: hash.refine((v) => !/^0x0{64}$/.test(v)), returnRecipient: cctpAddressSchema, intentPolicyHash: hash });
const lifecycleAnchor = z.object({ transactionHash: hash, blockNumber: uint, blockHash: hash, timestamp: time,
  logIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
const lifecycle = z.discriminatedUnion('status', [
  z.object({ version: z.literal(1), status: z.literal('unavailable'), reason: text }),
  z.object({ version: z.literal(1), status: z.literal('verified'), burn: lifecycleAnchor, mint: lifecycleAnchor,
    returnRequest: lifecycleAnchor.extend({ readyAt: time }).optional(), outcome: lifecycleAnchor.extend({ kind: z.enum(['paid', 'returned']) }).optional() }),
]);
const result = z.object({ messageId: hash, evidence,
  release: z.object({ recipient: cctpAddressSchema, amount: uint, state: z.enum(['PENDING', 'VERIFIED', 'HELD', 'REJECTED', 'EXECUTED', 'RETURNED']),
    reviewedUntil: time, delayUntil: time.optional() }).optional(), payment: payment.optional(), proof: proof.optional(),
  recommendation: z.enum(['HOLD', 'REJECT', 'NONE']).optional(), reason: text.optional(),
  lifecycle: lifecycle.optional(),
  behavioral: behavioralAdvisorySchema.optional(),
}).superRefine((r, ctx) => {
  if (r.evidence.status === 'verified' && (!r.release || !r.payment || !r.proof || r.evidence.amount !== r.release.amount)) ctx.addIssue({ code: 'custom', message: 'Incomplete reported customer proof.' });
  if (r.proof && r.evidence.status !== 'verified') ctx.addIssue({ code: 'custom', message: 'Proof attached to unverified observation.' });
  if (r.release && !r.payment) ctx.addIssue({ code: 'custom', message: 'Customer payment state missing.' });
  if (r.release?.state === 'RETURNED' && !r.payment?.returned) ctx.addIssue({ code: 'custom', message: 'Returned state missing credit disposition.' });
  if (r.payment && (r.payment.reviewedVersion > r.payment.version || (r.payment.returned && (r.release?.state !== 'RETURNED' || r.payment.returnAt === 0n)) ||
    (!r.payment.returned && r.release?.state === 'RETURNED') || (r.payment.returned && r.payment.returnAt > r.payment.now))) ctx.addIssue({ code: 'custom', message: 'Conflicting returned/policy state.' });
  if (r.lifecycle && !r.proof) ctx.addIssue({ code: 'custom', message: 'Lifecycle without current verified backing.' });
  const l = r.lifecycle;
  if (l?.status === 'verified' && r.proof && r.release && r.payment) {
    const p = r.proof, terminal = r.release.state === 'EXECUTED' || r.release.state === 'RETURNED';
    if (l.burn.transactionHash !== p.sourceTransactionHash || l.burn.blockNumber !== p.sourceBlock || l.burn.blockHash !== p.sourceBlockHash ||
      l.mint.transactionHash !== p.destinationTransactionHash || l.mint.blockNumber !== p.destinationBlock || l.mint.blockHash !== p.destinationBlockHash ||
      terminal !== Boolean(l.outcome) || (r.payment.returnAt > 0n) !== Boolean(l.returnRequest) ||
      (l.returnRequest && (l.returnRequest.readyAt !== r.payment.returnAt || l.returnRequest.readyAt <= l.returnRequest.timestamp)) ||
      (l.outcome?.kind === 'paid' && (r.release.state !== 'EXECUTED' || Boolean(l.returnRequest))) ||
      (l.outcome?.kind === 'returned' && (r.release.state !== 'RETURNED' || !l.returnRequest || l.outcome.timestamp < l.returnRequest.readyAt))) ctx.addIssue({ code: 'custom', message: 'Lifecycle differs from authenticated credit/state.' });
    const anchors = [l.mint, ...(l.returnRequest ? [l.returnRequest] : []), ...(l.outcome ? [l.outcome] : [])];
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i], previous = anchors[i - 1];
      if (anchor.timestamp > r.payment.now || (previous && (anchor.blockNumber < previous.blockNumber || anchor.timestamp < previous.timestamp ||
        (anchor.blockNumber === previous.blockNumber && (anchor.blockHash !== previous.blockHash || anchor.timestamp !== previous.timestamp || anchor.logIndex <= previous.logIndex))))) ctx.addIssue({ code: 'custom', message: 'Lifecycle clocks or event order conflict.' });
    }
  }
});
const observation = z.object({ ...envelope, mode: z.literal('observe'), status: z.literal('ok'), route: routeField, policy: z.literal('customer-payment'),
  fixture: z.boolean().optional(),
  observedAt: z.string().datetime(), finalized: block,
  scope: z.object({ manifestVersion: z.literal(3), vault: cctpAddressSchema, guardian: cctpAddressSchema, operator: cctpAddressSchema }),
  counts: z.object({ verified: z.number().int().min(0).max(1000), pending: z.number().int().min(0).max(1000), unavailable: z.number().int().min(0).max(1000), invalid: z.number().int().min(0).max(1000) }),
  results: z.array(result).max(1000), blockers: texts,
  discovery: discovery.optional(),
  worker: worker.optional(),
}).superRefine((r, ctx) => {
  if (r.worker && r.worker.state !== 'scheduled') ctx.addIssue({ code: 'custom', message: 'Successful observation has failed/stopped worker metadata.' });
  for (const row of r.results) if (row.behavioral?.status === 'reported') {
    const a = row.behavioral.assessment;
    if (a.route !== r.route || a.transferId !== row.messageId || a.synthetic !== (r.fixture === true) ||
      a.checkedAt !== Math.floor(Date.parse(r.observedAt) / 1000))
      ctx.addIssue({ code: 'custom', message: 'Behavioral advisory differs from its payment scope, provenance or report check time.' });
  }
  const ids = new Set(r.results.map((row) => row.messageId));
  if (ids.size !== r.results.length) ctx.addIssue({ code: 'custom', message: 'Duplicate payment.' });
  if (r.discovery?.version === 2) {
    const head = r.discovery.incremental.destinationHead;
    if (head.number > r.finalized.number || head.timestamp > r.finalized.timestamp || (head.number === r.finalized.number &&
      (head.hash !== r.finalized.hash || head.timestamp !== r.finalized.timestamp))) ctx.addIssue({ code: 'custom', message: 'Discovery finalized tip differs from audited snapshot.' });
  }
  if (r.discovery && (r.discovery.counts.paired !== r.results.length || r.discovery.destination.through.number > r.finalized.number ||
    r.discovery.destination.through.timestamp > r.finalized.timestamp || (r.discovery.destination.through.number === r.finalized.number &&
      (r.discovery.destination.through.hash !== r.finalized.hash || r.discovery.destination.through.timestamp !== r.finalized.timestamp)) || r.discovery.unmatchedDestination.some((hint) => ids.has(hint.messageId)))) ctx.addIssue({ code: 'custom', message: 'Discovery coverage differs from audited rows.' });
  if (r.discovery) for (const row of r.results) if (row.proof && (row.proof.sourceBlock < r.discovery.source.from || row.proof.sourceBlock > r.discovery.source.through.number ||
    row.proof.destinationBlock < r.discovery.destination.from || row.proof.destinationBlock > r.discovery.destination.through.number ||
    (row.proof.sourceBlock === r.discovery.source.through.number && row.proof.sourceBlockHash !== r.discovery.source.through.hash) ||
    (row.proof.destinationBlock === r.discovery.destination.through.number && row.proof.destinationBlockHash !== r.discovery.destination.through.hash) ||
    r.discovery.pendingSource.some((h) => h.operationId === row.proof?.operationId) || r.discovery.conflicts.includes(row.proof.operationId))) ctx.addIssue({ code: 'custom', message: 'Audited proof lies outside discovery coverage.' });
  for (const status of ['verified', 'pending', 'unavailable', 'invalid'] as const) if (r.counts[status] !== r.results.filter((row) => row.evidence.status === status).length) ctx.addIssue({ code: 'custom', message: 'Reported counts do not match rows.' });
  for (const row of r.results) if ((row.proof && row.proof.destinationBlock > r.finalized.number) || (row.payment && row.payment.now !== r.finalized.timestamp)) ctx.addIssue({ code: 'custom', message: 'Mixed observation blocks.' });
  for (const row of r.results) if (row.lifecycle?.status === 'verified') {
    const l = row.lifecycle;
    for (const a of [l.mint, ...(l.returnRequest ? [l.returnRequest] : []), ...(l.outcome ? [l.outcome] : [])]) {
      if (a.blockNumber > r.finalized.number || (a.blockNumber === r.finalized.number && (a.blockHash !== r.finalized.hash || a.timestamp !== r.finalized.timestamp))) ctx.addIssue({ code: 'custom', message: 'Lifecycle outside finalized snapshot.' });
    }
  }
});
const unavailable = z.object({ ...envelope, mode: z.literal('observe'), status: z.enum(['unavailable', 'quarantined']), observedAt: z.string().datetime(), reason: text,
  fixture: z.boolean().optional(), worker: worker.optional(),
}).refine((r) => !r.worker || (r.worker.state !== 'scheduled' && (r.status !== 'quarantined' || r.worker.state === 'stopped')));
const displayWorker = (w: z.infer<typeof worker> | undefined): OperationsSnapshot['observer'] => w ? {
  state: w.state, attempt: w.attempt, failures: w.consecutiveFailures, nextCheckSeconds: w.nextPollSeconds,
} : undefined;
const routeLabel = 'Base Sepolia → Ethereum Sepolia · USDC';
export function parseOperationsReport(value: unknown): OperationsSnapshot {
  const common = { routeLabel, provenance: 'imported' as const, synthetic: false, accounts: [], blocks: [], contracts: [], payments: [], notes: [] };
  if (value && typeof value === 'object' && 'mode' in value && value.mode === 'keyless-predeployment') {
    const r = readiness.parse(value);
    return { ...common, kind: 'readiness', capturedAt: r.capturedAt, packageHash: r.packageHash,
      blockers: r.blockers, notes: r.remainingGates, contracts: [{ label: 'Guardian', address: r.predicted.guardian, predicted: true }, { label: 'Payment escrow', address: r.predicted.vault, predicted: true }],
      accounts: r.accounts.map((a) => ({ network: a.chainId === route.source.chainId ? 'Base Sepolia' : 'Ethereum Sepolia', address: a.address, roles: a.roles, balance: a.ethWei, symbol: 'ETH', decimals: 18 })),
      sourceTokenBalance: { amount: r.sourceUsdcBaseUnits, symbol: 'USDC', decimals: route.decimals },
      blocks: [{ label: 'Source', ...r.snapshots.source, time: r.snapshots.source.timestamp }, { label: 'Destination', ...r.snapshots.destination, time: r.snapshots.destination.timestamp }] };
  }
  if (value && typeof value === 'object' && 'status' in value && (value.status === 'unavailable' || value.status === 'quarantined')) {
    const r = unavailable.parse(value); return { ...common, kind: 'unavailable', synthetic: r.fixture === true, capturedAt: r.observedAt, observer: displayWorker(r.worker), blockers: [r.status === 'quarantined' ? 'Operator quarantined. Reconcile its journal before continuing.' : 'Observation unavailable.', r.reason] };
  }
  const r = observation.parse(value);
  const payments: OperationsPayment[] = r.results.map((row) => {
    const state: OperationsPayment['state'] = row.release?.state === 'RETURNED' ? 'Returned' : row.release?.state === 'EXECUTED' ? 'Paid'
      : row.payment && row.payment.returnAt > 0n ? 'Return requested' : row.release?.state === 'REJECTED' ? 'Rejected'
      : row.evidence.status === 'unavailable' ? 'Unavailable' : row.recommendation === 'HOLD' || row.release?.state === 'HELD' || row.payment?.blockers.length ? 'Held' : 'Pending';
    const l = row.lifecycle;
    const displayedLifecycle: OperationsPayment['lifecycle'] = l?.status === 'verified' ? {
      status: 'reported', closed: Boolean(l.outcome), clockWarning: l.burn.timestamp > l.mint.timestamp,
      settlementSeconds: l.burn.timestamp <= l.mint.timestamp ? l.mint.timestamp - l.burn.timestamp : undefined,
      escrowSeconds: (l.outcome?.timestamp ?? r.finalized.timestamp) - l.mint.timestamp,
      milestones: [{ label: 'Source burn', ...l.burn, time: l.burn.timestamp, hash: l.burn.transactionHash, explorerUrl: `${baseSepolia.blockExplorers.default.url}/tx/${l.burn.transactionHash}` },
        { label: 'Escrow funded', ...l.mint, time: l.mint.timestamp, hash: l.mint.transactionHash, explorerUrl: `${sepolia.blockExplorers.default.url}/tx/${l.mint.transactionHash}` },
        ...(l.returnRequest ? [{ label: 'Return requested', time: l.returnRequest.timestamp, hash: l.returnRequest.transactionHash, explorerUrl: `${sepolia.blockExplorers.default.url}/tx/${l.returnRequest.transactionHash}` }] : []),
        ...(l.outcome ? [{ label: l.outcome.kind === 'paid' ? 'Recipient paid' : 'Credit returned', time: l.outcome.timestamp, hash: l.outcome.transactionHash, explorerUrl: `${sepolia.blockExplorers.default.url}/tx/${l.outcome.transactionHash}` }] : [])],
    } : l ? { status: 'unavailable', reason: l.reason, milestones: [], closed: false, clockWarning: false } : undefined;
    return { id: row.messageId, state, evidence: row.evidence.status, recipient: row.release?.recipient, amount: row.release?.amount, symbol: 'USDC', decimals: route.decimals,
      lifecycle: displayedLifecycle,
      behavioral: row.behavioral,
      reasons: [row.reason, row.evidence.status === 'verified' ? 'Backing reported verified; this file does not authorize release.' : row.evidence.reason,
        ...(row.payment?.blockers.map((b) => ({ paused: 'Customer paused payments.', recipient: 'Recipient is outside current policy.', amount: 'Amount exceeds customer policy.', approval: 'Current customer approval is required.' })[b]) ?? []),
        state === 'Rejected' ? 'Rejection does not return funded USDC. Customer recovery is a separate action.' : undefined].filter((v): v is string => Boolean(v)),
      policyVersion: row.payment?.version, policyHash: row.payment?.hash, returnAt: row.payment?.returnAt,
      operationId: row.proof?.operationId, returnRecipient: row.proof?.returnRecipient, intentPolicyHash: row.proof?.intentPolicyHash,
      transactions: row.proof ? [{ label: 'Source burn receipt', hash: row.proof.sourceTransactionHash, block: row.proof.sourceBlock, blockHash: row.proof.sourceBlockHash, explorerUrl: `${baseSepolia.blockExplorers.default.url}/tx/${row.proof.sourceTransactionHash}` },
        { label: 'Destination mint receipt', hash: row.proof.destinationTransactionHash, block: row.proof.destinationBlock, blockHash: row.proof.destinationBlockHash, explorerUrl: `${sepolia.blockExplorers.default.url}/tx/${row.proof.destinationTransactionHash}` }] : [] };
  });
  return { ...common, kind: 'payments', observationScope: JSON.stringify(r.scope), synthetic: r.fixture === true, capturedAt: r.observedAt, blockers: r.blockers, payments, observer: displayWorker(r.worker),
    discovery: r.discovery ? { ranges: [{ label: 'Base Sepolia', from: r.discovery.source.from, through: r.discovery.source.through.number },
      { label: 'Ethereum Sepolia', from: r.discovery.destination.from, through: r.discovery.destination.through.number }], ...r.discovery.counts,
      incremental: r.discovery.version === 2 ? { resumed: r.discovery.incremental.resumed, ranges: [
        { label: 'Base Sepolia', from: r.discovery.incremental.sourceFrom, through: r.discovery.source.through.number, remaining: r.discovery.incremental.sourceHead.number - r.discovery.source.through.number },
        { label: 'Ethereum Sepolia', from: r.discovery.incremental.destinationFrom, through: r.discovery.destination.through.number, remaining: r.discovery.incremental.destinationHead.number - r.discovery.destination.through.number }] } : undefined,
      conflicts: r.discovery.conflicts, pendingSource: r.discovery.pendingSource.map((h) => ({ ...h, explorerUrl: `${baseSepolia.blockExplorers.default.url}/tx/${h.transactionHash}` })),
      unmatchedDestination: r.discovery.unmatchedDestination.map((h) => ({ ...h, explorerUrl: `${sepolia.blockExplorers.default.url}/tx/${h.transactionHash}` })) } : undefined,
    contracts: [{ label: 'Guardian', address: r.scope.guardian, predicted: false }, { label: 'Payment escrow', address: r.scope.vault, predicted: false }],
    blocks: [{ label: 'Finalized destination', number: r.finalized.number, hash: r.finalized.hash, time: r.finalized.timestamp }] };
}
export const OPERATIONS_FILE_LIMIT = 2_000_000;
export function readOperationsText(textInput: string): OperationsSnapshot {
  if (new TextEncoder().encode(textInput).byteLength > OPERATIONS_FILE_LIMIT) throw new Error('Public report exceeds 2 MB.');
  return parseOperationsReport(JSON.parse(textInput));
}
