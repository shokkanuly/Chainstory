// Public file vectors; synthetic states/receipts do not establish a deployment.
import { describe, expect, it } from 'vitest';
import sample from '../../../testing/fixtures/tripwire/operations-synthetic.json';
import discoverySample from '../../../testing/fixtures/tripwire/operations-discovery-synthetic.json';
import resumedSample from '../../../testing/fixtures/tripwire/operations-discovery-resumed-synthetic.json';
import workerSample from '../../../testing/fixtures/tripwire/operations-worker-synthetic.json';
import outageSample from '../../../testing/fixtures/tripwire/operations-worker-outage-synthetic.json';
import { parseOperationsReport, readOperationsText } from '../operations';
import { formatBaseUnits, formatDuration, snapshotAge } from '../../../domain/operations';
const fresh = () => structuredClone(sample);
const hash = `0x${'1'.repeat(64)}`, address = `0x${'2'.repeat(40)}`;
function readiness() {
  return { version: 1, mode: 'keyless-predeployment', enforcement: false, submittedTransactions: 0,
    route: sample.route, capturedAt: sample.observedAt, packageHash: hash, predicted: { vault: address, guardian: address },
    snapshots: { source: sample.finalized, destination: sample.finalized },
    accounts: [{ chainId: 84532, address, roles: ['source-sender'], ethWei: '0' }], sourceUsdcBaseUnits: '0',
    fundingAndNonceChecks: 'blocked', blockers: ['NO_SOURCE_USDC'], remainingGates: ['Deployment and external review pending.'] };
}
describe('read-only operations report boundary', () => {
  it('preserves exact net amounts and distinguishes held, rejected, paid and returned', () => {
    const view = readOperationsText(JSON.stringify(sample)); expect(view.synthetic).toBe(true);
    expect(view.payments.map((r) => r.state)).toEqual(['Held', 'Rejected', 'Paid', 'Returned']);
    expect(view.payments[0].amount).toBe(1_000_001n); expect(view.payments[0].reasons).toContain('Current customer approval is required.');
    expect(view.payments[1].reasons.join(' ')).toContain('Rejection does not return');
    expect(view.payments[3].returnRecipient).toBe(sample.results[3].proof.returnRecipient);
    expect(view.payments[0].transactions[0].explorerUrl).toBe(`https://sepolia.basescan.org/tx/${sample.results[0].proof.sourceTransactionHash}`);
    expect(view.payments[0].transactions[1].explorerUrl).toBe(`https://sepolia.etherscan.io/tx/${sample.results[0].proof.destinationTransactionHash}`);
  });
  it('shows readiness balances and predicted addresses without claiming accepted deployment or payments', () => {
    const view = parseOperationsReport(readiness()); expect(view.kind).toBe('readiness'); expect(view.payments).toEqual([]);
    expect(view.contracts.every((c) => c.predicted)).toBe(true); expect(view.sourceTokenBalance?.amount).toBe(0n);
    expect(view.accounts[0].balance).toBe(0n); expect(view.blockers).toEqual(['NO_SOURCE_USDC']); expect(view.notes).toHaveLength(1);
  });
  it.each(['unavailable', 'quarantined'])('displays %s with no previous rows or balances', (status) => {
    const view = parseOperationsReport({ version: 1, mode: 'observe', enforcement: false, status, observedAt: sample.observedAt, reason: 'RPC unavailable.' });
    expect(view.kind).toBe('unavailable'); expect(view.payments).toEqual([]); expect(view.blocks).toEqual([]); expect(view.accounts).toEqual([]);
  });
  it.each([{ version: 2 }, { enforcement: true }, { policy: 'legacy-post-mint' }, { mode: 'audit' }, { route: 'mainnet' },
    { observedAt: 'yesterday' }, { status: 'ALLOW' }, { scope: { ...sample.scope, manifestVersion: 2 } }, { finalized: { ...sample.finalized, number: 200 } }])('refuses unsupported report %j', (patch) => {
    expect(() => parseOperationsReport({ ...fresh(), ...patch })).toThrow();
  });
  it.each(['count', 'duplicate', 'negative', 'float', 'numeric', 'uintOverflow', 'unverifiedProof', 'missingProof', 'missingPayment', 'amountMismatch', 'policyAhead', 'returnedFlag', 'returnFuture', 'mixedTime', 'mintAhead'] as const)
  ('refuses internally inconsistent payment data: %s', (failure) => {
    const r: Record<string, unknown> = fresh(), rows = r.results as Record<string, unknown>[], row = rows[0];
    if (failure === 'count') r.counts = { ...sample.counts, verified: 3 };
    if (failure === 'duplicate') rows[1].messageId = row.messageId;
    const release = row.release as Record<string, unknown>, payment = row.payment as Record<string, unknown>, proof = row.proof as Record<string, unknown>;
    if (failure === 'negative') release.amount = '-1';
    if (failure === 'float') release.amount = '1.5';
    if (failure === 'numeric') release.amount = 1000001;
    if (failure === 'uintOverflow') release.amount = (1n << 256n).toString();
    if (failure === 'unverifiedProof') { row.evidence = { status: 'pending', reason: 'Wait' }; r.counts = { ...sample.counts, verified: 3, pending: 1 }; }
    if (failure === 'missingProof') delete row.proof;
    if (failure === 'missingPayment') delete row.payment;
    if (failure === 'amountMismatch') release.amount = '1';
    if (failure === 'policyAhead') payment.reviewedVersion = '2';
    if (failure === 'returnedFlag') release.state = 'RETURNED';
    if (failure === 'returnFuture') { release.state = 'RETURNED'; payment.returned = true; payment.returnAt = '1791270001'; }
    if (failure === 'mixedTime') payment.now = '1791270001';
    if (failure === 'mintAhead') proof.destinationBlock = '201';
    expect(() => parseOperationsReport(r)).toThrow();
  });
  it('clearly separates requested recovery from a returned credit, using the recorded chain clock', () => {
    const r = fresh(); r.results[0].payment.returnAt = '1791270001';
    const rows = r.results as Record<string, unknown>[]; delete rows[0].lifecycle;
    expect(parseOperationsReport(r).payments[0].state).toBe('Return requested');
  });
  it('permits a failed single request only as unavailable, with no made-up amount or receipt', () => {
    const r = { ...fresh(), counts: { verified: 0, pending: 0, invalid: 0, unavailable: 1 }, results: [{ messageId: hash, evidence: { status: 'unavailable', reason: 'Payout read unavailable.' }, recommendation: 'HOLD' }] };
    const row = parseOperationsReport(r).payments[0]; expect(row.state).toBe('Unavailable'); expect(row.amount).toBeUndefined(); expect(row.transactions).toEqual([]);
  });
  it('rejects inconsistent readiness status, unknown chain or numeric money', () => {
    expect(() => parseOperationsReport({ ...readiness(), fundingAndNonceChecks: 'passed' })).toThrow();
    expect(() => parseOperationsReport({ ...readiness(), accounts: [{ chainId: 1, address, roles: ['source-sender'], ethWei: '0' }] })).toThrow();
    expect(() => parseOperationsReport({ ...readiness(), sourceUsdcBaseUnits: 0 })).toThrow();
  });
  it('bounds file size, JSON, rows and strings; removes bidi controls and ignores untrusted URLs', () => {
    expect(() => readOperationsText('x'.repeat(2_000_001))).toThrow('2 MB'); expect(() => readOperationsText('{broken')).toThrow();
    const r = fresh(); r.results[0].reason = 'Visible\u202eevidence';
    expect(parseOperationsReport(r).payments[0].reasons[0]).toBe('Visibleevidence');
    expect(() => parseOperationsReport({ ...r, blockers: ['x'.repeat(2049)] })).toThrow();
    expect(() => parseOperationsReport({ ...r, results: Array.from({ length: 1001 }, () => r.results[0]) })).toThrow();
    const withUrl = { ...r, explorerUrl: 'javascript:alert(1)' };
    expect(parseOperationsReport(withUrl).payments[0].transactions[0].explorerUrl).toMatch(/^https:\/\/sepolia.basescan.org\/tx\/0x/);
  });
  it('treats an empty manifest as no listed requests, never inventing all-treasury totals', () => {
    const r = { ...fresh(), results: [], counts: { verified: 0, pending: 0, unavailable: 0, invalid: 0 } };
    expect(parseOperationsReport(r).payments).toEqual([]);
  });
});

describe('imported lifecycle consistency and block-time durations', () => {
  it('keeps settlement separate from time in escrow, including rejected funded money', () => {
    const rows = parseOperationsReport(fresh()).payments;
    expect(rows[0].lifecycle).toMatchObject({ settlementSeconds: 100n, escrowSeconds: 6300n, closed: false });
    expect(rows[1].lifecycle?.escrowSeconds).toBe(6300n);
    expect(rows[2].lifecycle).toMatchObject({ escrowSeconds: 300n, closed: true });
    expect(rows[3].lifecycle).toMatchObject({ escrowSeconds: 5500n, closed: true });
    expect(rows[3].lifecycle?.milestones.map((m) => m.label)).toEqual(['Source burn', 'Escrow funded', 'Return requested', 'Credit returned']);
    expect(rows[2].lifecycle?.milestones[2].explorerUrl).toBe(`https://sepolia.etherscan.io/tx/${sample.results[2].lifecycle.outcome?.transactionHash}`);
  });
  it('supports older reports and explicit history failure without estimating missing times', () => {
    const r = fresh(), rows = r.results as Record<string, unknown>[]; delete rows[2].lifecycle;
    rows[3].lifecycle = { version: 1, status: 'unavailable', reason: 'Receipt history unavailable.' };
    const view = parseOperationsReport(r);
    expect(view.payments[2].lifecycle).toBeUndefined(); expect(view.payments[2].state).toBe('Paid');
    expect(view.payments[3].state).toBe('Returned'); expect(view.payments[3].lifecycle).toMatchObject({ status: 'unavailable', milestones: [] });
    expect(view.payments[3].lifecycle?.escrowSeconds).toBeUndefined();
  });
  it('does not fabricate a negative cross-chain settlement duration', () => {
    const r = fresh(); r.results[0].lifecycle.burn.timestamp = '1791270001';
    const l = parseOperationsReport(r).payments[0].lifecycle;
    expect(l?.clockWarning).toBe(true); expect(l?.settlementSeconds).toBeUndefined(); expect(l?.escrowSeconds).toBe(6300n);
  });
  it.each(['version', 'mintAnchor', 'burnAnchor', 'missingOutcome', 'wrongOutcome', 'unrequestedReturn', 'clockOrder', 'blockOrder',
    'outcomeAhead', 'headHash', 'headClock', 'sameBlockHash', 'sameBlockOrder', 'floatTime', 'wrongMaturity', 'earlyReturn', 'missingRequest', 'unverifiedBacking'] as const)
  ('refuses contradictory lifecycle: %s', (failure) => {
    const r: Record<string, unknown> = fresh(), rows = r.results as Record<string, unknown>[], row = rows[failure === 'wrongMaturity' || failure === 'earlyReturn' || failure === 'missingRequest' ? 3 : 2];
    const l = row.lifecycle as Record<string, unknown>, mint = l.mint as Record<string, unknown>, burn = l.burn as Record<string, unknown>, outcome = l.outcome as Record<string, unknown>;
    if (failure === 'version') l.version = 2;
    if (failure === 'mintAnchor') mint.transactionHash = hash;
    if (failure === 'burnAnchor') burn.blockHash = hash;
    if (failure === 'missingOutcome') delete l.outcome;
    if (failure === 'wrongOutcome') outcome.kind = 'returned';
    if (failure === 'unrequestedReturn') l.returnRequest = { ...mint, readyAt: '1791269000' };
    if (failure === 'clockOrder') outcome.timestamp = '1791263699';
    if (failure === 'blockOrder') outcome.blockNumber = '99';
    if (failure === 'outcomeAhead') outcome.blockNumber = '201';
    if (failure === 'headHash') { outcome.blockNumber = '200'; outcome.timestamp = sample.finalized.timestamp; }
    if (failure === 'headClock') { outcome.blockNumber = '200'; outcome.blockHash = sample.finalized.hash; }
    if (failure === 'sameBlockHash') { outcome.blockNumber = mint.blockNumber; outcome.timestamp = mint.timestamp; }
    if (failure === 'sameBlockOrder') { outcome.blockNumber = mint.blockNumber; outcome.timestamp = mint.timestamp; outcome.blockHash = mint.blockHash; outcome.logIndex = mint.logIndex; }
    if (failure === 'floatTime') mint.timestamp = '1.5';
    if (failure === 'wrongMaturity') (l.returnRequest as Record<string, unknown>).readyAt = '1791269001';
    if (failure === 'earlyReturn') outcome.timestamp = '1791268999';
    if (failure === 'missingRequest') delete l.returnRequest;
    if (failure === 'unverifiedBacking') { row.evidence = { status: 'unavailable', reason: 'Outage' }; delete row.proof; r.counts = { ...sample.counts, verified: 3, unavailable: 1 }; }
    expect(() => parseOperationsReport(r)).toThrow();
  });
  it('formats exact durations without converting bigint to floating point', () => {
    expect(formatDuration(0n)).toBe('0s'); expect(formatDuration(90061n)).toBe('1d 1h 1m 1s');
    expect(formatDuration(10n ** 24n)).toContain(`${10n ** 24n / 86400n}d`);
    expect(() => formatDuration(-1n)).toThrow();
  });
});

describe('automatic discovery coverage in public snapshots', () => {
  it('distinguishes audited payments from unverified source/destination hints and shows bounded ranges', () => {
    const view = parseOperationsReport(discoverySample);
    expect(view.payments).toHaveLength(4); expect(view.discovery).toMatchObject({ paired: 4, sourceHints: 7, destinationHints: 6 });
    expect(view.discovery?.pendingSource).toHaveLength(1); expect(view.discovery?.unmatchedDestination).toHaveLength(2);
    expect(view.discovery?.conflicts).toHaveLength(1);
    expect(view.discovery?.ranges[0]).toMatchObject({ from: 0n, through: 75n });
    expect(view.discovery?.pendingSource[0].explorerUrl).toMatch(/^https:\/\/sepolia.basescan.org\/tx\/0x/);
    expect(view.discovery?.unmatchedDestination[0].explorerUrl).toMatch(/^https:\/\/sepolia.etherscan.io\/tx\/0x/);
  });
  it.each(['wrongMode', 'notHints', 'negativeFrom', 'rangeAhead', 'rangeTooLarge', 'pairedCount', 'destinationCount', 'sourceCount',
    'duplicateConflict', 'duplicatePending', 'conflictingPending', 'missingConflict', 'auditedUnmatched', 'proofOutOfRange', 'zeroOperation', 'numericBlock', 'headAhead', 'headHash', 'headClock', 'sourceProofHash', 'destinationProofHash'] as const)
  ('refuses inconsistent discovery metadata: %s', (failure) => {
    const r = structuredClone(discoverySample), d = r.discovery;
    if (failure === 'wrongMode') (d as Record<string, unknown>).mode = 'live';
    if (failure === 'notHints') (d as Record<string, unknown>).hintOnly = false;
    if (failure === 'negativeFrom') d.source.from = '-1';
    if (failure === 'rangeAhead') d.source.from = '76';
    if (failure === 'rangeTooLarge') d.source.through.number = '4096';
    if (failure === 'pairedCount') d.counts.paired = 3;
    if (failure === 'destinationCount') d.counts.destinationHints = 5;
    if (failure === 'sourceCount') d.counts.sourceHints = 3;
    if (failure === 'duplicateConflict') d.conflicts.push(d.conflicts[0]);
    if (failure === 'duplicatePending') d.pendingSource.push(d.pendingSource[0]);
    if (failure === 'conflictingPending') d.pendingSource[0].operationId = d.conflicts[0];
    if (failure === 'missingConflict') d.conflicts = [];
    if (failure === 'auditedUnmatched') d.unmatchedDestination[0].messageId = r.results[0].messageId;
    if (failure === 'proofOutOfRange') d.source.from = '51';
    if (failure === 'zeroOperation') d.pendingSource[0].operationId = `0x${'0'.repeat(64)}`;
    if (failure === 'numericBlock') (d.source as Record<string, unknown>).from = 0;
    if (failure === 'headAhead') d.destination.through.number = '201';
    if (failure === 'headHash') d.destination.through.hash = hash;
    if (failure === 'headClock') d.destination.through.timestamp = '1791269999';
    if (failure === 'sourceProofHash') d.source.through.number = '50';
    if (failure === 'destinationProofHash') { d.destination.through.number = '100'; d.destination.through.timestamp = '1791263700'; }
    expect(() => parseOperationsReport(r)).toThrow();
  });
});
describe('snapshot display arithmetic and recency', () => {
  it.each([[1_000_001n, 6, '1.000001'], [1n, 18, '0.000000000000000001'], [0n, 6, '0'], [123n, 0, '123'], [(1n << 200n) + 7n, 6, '1606938044258990275541962092341162602522202993782792835.301383']] as const)
  ('formats %s without floating-point rounding', (amount, decimals, formatted) => expect(formatBaseUnits(amount, decimals)).toBe(formatted));
  it.each([[-1n, 6], [1n, -1], [1n, 1.5], [1n, 37]] as const)('refuses invalid display units %s/%s', (amount, decimals) => expect(() => formatBaseUnits(amount, decimals)).toThrow());
  it('flags aging snapshots and suspect future clocks without changing a payment status', () => {
    const now = Date.parse(sample.observedAt);
    expect(snapshotAge(sample.observedAt, now + 300_000)).toBe('recent'); expect(snapshotAge(sample.observedAt, now + 300_001)).toBe('stale');
    expect(snapshotAge(sample.observedAt, now - 120_001)).toBe('future'); expect(snapshotAge('bad', now)).toBe('future');
  });
});


describe('public persistent discovery coverage', () => {
  it('separates cumulative searched history from this run and preserves older audited receipts', () => {
    const view = parseOperationsReport(resumedSample);
    expect(view.discovery?.ranges[0]).toMatchObject({ from: 0n, through: 75n });
    expect(view.discovery?.incremental).toMatchObject({ resumed: true, ranges: [{ label: 'Base Sepolia', from: 70n, through: 75n }, { label: 'Ethereum Sepolia', from: 199n, through: 200n }] });
    expect(view.payments).toHaveLength(4); expect(view.synthetic).toBe(true);
  });
  it('accepts cumulative coverage beyond a single bounded increment', () => {
    const r = structuredClone(resumedSample); r.discovery.source.through.number = '5000'; r.discovery.incremental.sourceFrom = '4999'; r.discovery.incremental.sourceHead.number = '5000';
    expect(parseOperationsReport(r).discovery?.ranges[0].through).toBe(5000n);
  });
  it('represents an idle resumed network without claiming new blocks were searched', () => {
    const r = structuredClone(resumedSample); r.discovery.incremental.sourceFrom = '76'; r.discovery.incremental.destinationFrom = '201';
    expect(parseOperationsReport(r).discovery?.incremental?.ranges[0]).toMatchObject({ from: 76n, through: 75n });
  });
  it('reports a finalized backlog separately from searched coverage', () => {
    const r = structuredClone(resumedSample); r.discovery.incremental.sourceHead.number = '93';
    expect(parseOperationsReport(r).discovery?.incremental?.ranges[0].remaining).toBe(18n);
  });
  it.each(['behind', 'hash', 'clock', 'audited-head'] as const)('rejects contradictory captured finalized tip: %s', (kind) => {
    const r = structuredClone(resumedSample);
    if (kind === 'behind') r.discovery.incremental.sourceHead.number = '74';
    if (kind === 'hash') r.discovery.incremental.sourceHead.hash = hash;
    if (kind === 'clock') r.discovery.incremental.sourceHead.timestamp = '1';
    if (kind === 'audited-head') r.discovery.incremental.destinationHead.number = '201';
    expect(() => parseOperationsReport(r)).toThrow();
  });
  it('accepts a first persistent search only with starts equal to cumulative bounds', () => {
    const r = structuredClone(resumedSample); r.discovery.incremental = { ...r.discovery.incremental, resumed: false, sourceFrom: '0', destinationFrom: '0' };
    expect(parseOperationsReport(r).discovery?.incremental?.resumed).toBe(false);
  });
  it.each(['missing', 'mode', 'from-before', 'from-after', 'gap', 'not-resumed', 'numeric', 'overflow', 'no-flag', 'backwards', 'future-destination', 'wrong-version'] as const)('refuses inconsistent resume coverage: %s', (kind) => {
    const r: Record<string, unknown> = structuredClone(resumedSample), d = r.discovery as Record<string, unknown>;
    const i = d.incremental as Record<string, unknown>, source = d.source as Record<string, unknown>;
    if (kind === 'missing') delete d.incremental;
    if (kind === 'mode') d.mode = 'bounded-finalized-hints';
    if (kind === 'from-before') { source.from = '1'; i.sourceFrom = '0'; }
    if (kind === 'from-after') i.sourceFrom = '77';
    if (kind === 'gap') { source.through = { ...resumedSample.discovery.source.through, number: '5000' }; i.sourceFrom = '1'; }
    if (kind === 'not-resumed') i.resumed = false;
    if (kind === 'numeric') i.sourceFrom = 70;
    if (kind === 'overflow') i.sourceFrom = (1n << 256n).toString();
    if (kind === 'no-flag') delete i.resumed;
    if (kind === 'backwards') source.from = '80';
    if (kind === 'future-destination') d.destination = { ...resumedSample.discovery.destination, through: { ...resumedSample.discovery.destination.through, number: '201' } };
    if (kind === 'wrong-version') d.version = 3;
    expect(() => parseOperationsReport(r)).toThrow();
  });
});


describe('background observer report boundary', () => {
  it('shows the planned next check separately from authenticated payment backing', () => {
    const view = parseOperationsReport(workerSample);
    expect(view.observer).toEqual({ state: 'scheduled', attempt: 8, failures: 0, nextCheckSeconds: 10 });
    expect(view.payments).toHaveLength(4); expect(view.synthetic).toBe(true);
  });
  it('replaces healthy rows with an outage snapshot and preserves the reported retry schedule', () => {
    const view = parseOperationsReport(outageSample);
    expect(view.observer).toEqual({ state: 'retrying', attempt: 7, failures: 3, nextCheckSeconds: 40 });
    expect(view.kind).toBe('unavailable'); expect(view.payments).toEqual([]); expect(view.blocks).toEqual([]); expect(view.synthetic).toBe(true);
  });
  it('accepts a stopped quarantined worker only without a planned retry', () => {
    const view = parseOperationsReport({ ...outageSample, status: 'quarantined', worker: { ...outageSample.worker, state: 'stopped', nextPollSeconds: 0 } });
    expect(view.observer?.state).toBe('stopped'); expect(view.observer?.nextCheckSeconds).toBe(0);
  });
  it.each([{ attempt: 0 }, { attempt: 1 }, { attempt: '7' }, { attempt: Number.MAX_SAFE_INTEGER + 1 }, { consecutiveFailures: -1 },
    { consecutiveFailures: 0 }, { consecutiveFailures: 8 }, { nextPollSeconds: 0 }, { nextPollSeconds: 20 }, { nextPollSeconds: 301 },
    { nextPollSeconds: '40' }, { intervalSeconds: 4 }, { intervalSeconds: 301 }, { intervalSeconds: 10.5 }, { state: 'healthy' },
    { version: 2 }, { state: 'stopped' }, { provider: 'secret' }])('rejects impossible retry metadata %j', (patch) => {
    expect(() => parseOperationsReport({ ...outageSample, worker: { ...outageSample.worker, ...patch } })).toThrow();
  });
  it('rejects a successful report with a failed worker and an unavailable report with successful worker metadata', () => {
    expect(() => parseOperationsReport({ ...workerSample, worker: outageSample.worker })).toThrow();
    expect(() => parseOperationsReport({ ...outageSample, worker: workerSample.worker })).toThrow();
    expect(() => parseOperationsReport({ ...outageSample, status: 'quarantined' })).toThrow();
  });
  it('caps a long outage retry delay without trusting a caller-supplied interval', () => {
    expect(parseOperationsReport({ ...outageSample, worker: { ...outageSample.worker, attempt: 10, consecutiveFailures: 10, nextPollSeconds: 300 } }).observer?.nextCheckSeconds).toBe(300);
  });
});
