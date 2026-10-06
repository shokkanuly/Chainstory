import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Search, AlertCircle, ArrowLeft, X } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import PageAurora from '@/components/motion/PageAurora';
import { readOperationsText, OPERATIONS_FILE_LIMIT } from '@/chains/evm/operations';
import { cleanDisplayText, formatBaseUnits, formatDuration, snapshotAge, type OperationsSnapshot, type OperationsPayment } from '@/domain/operations';
import { chooseReportDirectory, folderSupported, reportFolderReader, watchReportFolder } from './operationsFeed';
import '../App.css';

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const when = (value: string) => new Date(value).toLocaleString();
const states: OperationsPayment['state'][] = ['Pending', 'Held', 'Rejected', 'Paid', 'Return requested', 'Returned', 'Unavailable'];
const roleLabels: Record<string, string> = { deployer: 'Deployment', 'guardian-owner': 'Guardian owner', 'customer-policy': 'Customer policy', 'customer-return-request': 'Customer recovery', operator: 'Operator', 'source-sender': 'Sender' };
function explainBlocker(reason: string) {
  if (reason.startsWith('NO_GAS:')) return `Test ETH needed for ${reason.includes(':84532:') ? 'Base Sepolia' : 'Ethereum Sepolia'} account ${short(reason.split(':')[2] ?? '')}.`;
  if (reason.startsWith('NO_SOURCE_USDC')) return 'The sender needs test USDC on Base Sepolia.';
  if (reason.startsWith('DEPLOYER_NONCE_CHANGED')) return 'Deployment account activity changed. Prepare and review a new deployment package.';
  if (reason.startsWith('PREDICTED_ADDRESS_OCCUPIED')) return 'A predicted contract address is occupied. Reconcile the deployment package.';
  return reason;
}
export default function TripwireOperations() {
  const [report, setReport] = useState<OperationsSnapshot | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All states');
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const stopFeed = useRef<(() => void) | undefined>(undefined);
  const [folderName, setFolderName] = useState('');
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [selectingFolder, setSelectingFolder] = useState(false);
  useEffect(() => { const counter = generation; const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => { clearInterval(timer); counter.current++; stopFeed.current?.(); }; }, []);
  const clear = () => { stopFeed.current?.(); stopFeed.current = undefined; setFolderName(''); setCheckedAt(null); setSelectingFolder(false); generation.current++; setReport(null); setFileName(''); setError(''); setLoading(false); setQuery(''); setFilter('All states'); };
  const load = async (file: File) => {
    clear();
    const current = ++generation.current; setReport(null); setError(''); setFileName(''); setLoading(true); setQuery(''); setFilter('All states');
    try {
      if (file.size > OPERATIONS_FILE_LIMIT) throw new Error('Oversized');
      const parsed = readOperationsText(await file.text());
      if (current !== generation.current) return;
      setReport(parsed); setFileName(cleanDisplayText(file.name.slice(0, 120))); setNow(Date.now());
    } catch {
      if (current === generation.current) setError('This report could not be loaded. Use a public preflight or current customer-payment observer JSON file, up to 2 MB. No previous snapshot is being shown.');
    } finally { if (current === generation.current) setLoading(false); }
  };
  const followFolder = async () => {
    clear(); const current = ++generation.current; setSelectingFolder(true);
    try {
      const directory = await chooseReportDirectory();
      if (current !== generation.current) return;
      setFolderName(cleanDisplayText(directory.name.slice(0, 120)));
      const read = reportFolderReader(readOperationsText, OPERATIONS_FILE_LIMIT);
      stopFeed.current = watchReportFolder((signal) => read(directory, signal), (update) => {
        if (current !== generation.current) return;
        setReport(update.report); setFileName(update.fileName); setError(update.error);
        setCheckedAt(Date.now()); setNow(Date.now());
      });
    } catch (error) {
      if (current === generation.current && !(error instanceof DOMException && error.name === 'AbortError'))
        setError('Could not open a report folder. Use a supported browser or import a public report.');
    } finally { if (current === generation.current) setSelectingFolder(false); }
  };
  const visible = report?.payments.filter((row) => (filter === 'All states' || row.state === filter) &&
    [row.id, row.operationId, row.recipient, row.returnRecipient].some((v) => v?.toLowerCase().includes(query.trim().toLowerCase()))) ?? [];
  const age = report ? snapshotAge(report.capturedAt, now) : null;
  return <div className="relative isolate min-h-[100dvh] text-foreground">
    <PageAurora /><Navbar />
    <main className="mx-auto max-w-7xl space-y-7 px-4 pb-20 pt-28 sm:px-6 lg:px-8">
      <header className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div><Link to="/tripwire" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={15} /> Incident replay</Link>
          <p className="b-eyebrow">Tripwire · testnet operations</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">Know where a payment stands.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">Inspect funding checks, payment holds and customer returns from a public operator report. This view reads a snapshot; it cannot approve or send a payment.</p></div>
        <div className="flex shrink-0 flex-col gap-2"><button type="button" onClick={() => { void followFolder(); }} disabled={!folderSupported() || selectingFolder} className="rounded-xl border border-border bg-secondary px-5 py-3 text-sm font-semibold hover:bg-muted disabled:opacity-50">{selectingFolder ? 'Choosing folder…' : 'Follow public report folder'}</button><label className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-secondary px-5 py-3 text-sm font-semibold hover:bg-muted focus-within:outline-2 focus-within:outline-offset-2">
          <FileUp size={18} /> Import public report<input type="file" accept=".json,application/json" className="sr-only" aria-label="Import public operator report" onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void load(file); }} />
        </label><p className="max-w-xs text-xs leading-relaxed text-muted-foreground">Choose a folder containing only public observer reports. Folder access is read-only; reconnect after a page reload.</p></div>
      </header>
      {!folderSupported() && <p className="text-xs text-muted-foreground">Automatic folder updates are unavailable in this browser. Use manual report import.</p>}
      {folderName && <section className="b-card p-5" aria-label="Local folder updates"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">Following public reports</h2><p className="mt-2 break-all text-sm">{folderName}</p></div><button type="button" onClick={clear} className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs">Disconnect folder</button></div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">Checks this folder about every 5 seconds while the page is open. Browser background throttling can delay updates. Only completed observer reports are read; report contents remain unauthenticated.</p><p className="mt-2 text-xs text-muted-foreground">{checkedAt ? `Folder last checked ${new Date(checkedAt).toLocaleTimeString()}. Report capture time below determines freshness.` : 'Checking for a completed report…'}</p>{error && <p className="mt-2 text-xs">No previous payment snapshot is being shown. Folder checks will continue.</p>}</section>}
      <div aria-live="polite">{loading && <p className="text-sm text-muted-foreground">Reading report…</p>}{error && <p role="alert" className="b-card flex items-start gap-3 p-5"><AlertCircle size={20} className="shrink-0" />{error}</p>}</div>
      {!report && !loading && !error && <section className="b-card grid gap-8 p-6 sm:p-9 lg:grid-cols-2">
        <div><p className="b-eyebrow">No snapshot loaded</p><h2 className="mt-3 text-2xl font-semibold">Start with the evidence.</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Import the readiness report before deployment, or a customer-payment observer report after deployment. An empty page does not mean there are no outstanding payments.</p></div>
        <div className="space-y-4 text-sm"><p><strong>Before deployment</strong><br /><span className="text-muted-foreground">See wallet funding, source USDC and predicted contract addresses.</span></p><p><strong>After deployment</strong><br /><span className="text-muted-foreground">See listed payments, reasons for holds, policy versions and reported burn/mint evidence.</span></p><p className="text-muted-foreground">Choose public reports only. Keep wallet keys and private configuration files out of this viewer.</p></div>
      </section>}
      {report && <>
        <section className="b-card flex flex-col justify-between gap-4 p-5 sm:flex-row">
          <div className="min-w-0"><p className="b-eyebrow">{report.synthetic ? 'Synthetic example' : 'Imported snapshot'} · {report.kind === 'readiness' ? 'Funding readiness' : report.kind === 'payments' ? 'Listed customer payments' : 'Observation failed'}</p><p className="mt-2 font-semibold">{report.routeLabel}</p><p className="mt-1 break-all text-xs text-muted-foreground">{fileName} · captured {when(report.capturedAt)}</p></div>
          <div className="flex shrink-0 items-start gap-3"><span className="rounded-full border border-border px-3 py-1 text-xs">{age === 'stale' ? 'Older than 5 minutes' : age === 'future' ? 'Check report clock' : 'Recent snapshot'}</span><button type="button" onClick={clear} aria-label="Clear imported report" className="rounded-md p-1 hover:bg-muted"><X size={18} /></button></div>
        </section>
        <p className="text-xs leading-relaxed text-muted-foreground">This file is not independently authenticated by the browser. {folderName ? 'New completed reports replace this snapshot automatically.' : 'Import a new report to refresh.'} Listed requests may omit other payments, and receipt links do not establish a payout. {age !== 'recent' && <strong className="text-foreground">Refresh the snapshot before relying on its status.</strong>}</p>
        {report.observer && <section className="b-card p-5"><h2 className="font-semibold">Background checks</h2><p className="mt-2 text-sm">{report.observer.state === 'scheduled' ? 'Last check completed.' : report.observer.state === 'retrying' ? 'Last check failed; another attempt was planned.' : 'Checks stopped; review the reported reason.'}</p><p className="mt-2 text-xs text-muted-foreground">Check {report.observer.attempt} · {report.observer.failures} consecutive failures</p>{report.observer.nextCheckSeconds > 0 && <p className="mt-1 text-xs text-muted-foreground">At capture, the next check was planned in {report.observer.nextCheckSeconds} seconds.</p>}<p className="mt-2 text-xs text-muted-foreground">{folderName ? 'Folder updates follow exported snapshots; they do not prove the observer is running.' : 'This imported file does not track the process live.'}</p></section>}
        {report.blockers.length > 0 && <section className="b-card p-5"><h2 className="flex items-center gap-2 font-semibold"><AlertCircle size={18} /> Requires attention</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">{report.blockers.map((reason, i) => <li key={i} className="break-words">{explainBlocker(reason)}</li>)}</ul></section>}
        {report.kind === 'readiness' && <>
          <section className="grid gap-4 sm:grid-cols-3"><Metric label="Source USDC available" value={report.sourceTokenBalance ? `${formatBaseUnits(report.sourceTokenBalance.amount, report.sourceTokenBalance.decimals)} ${report.sourceTokenBalance.symbol}` : 'Unavailable'} /><Metric label="Funding checks" value={report.blockers.length ? `${report.blockers.length} blockers` : 'Passed at snapshot'} /><Metric label="Deployment" value="Not accepted by this report" /></section>
          <section className="b-card overflow-hidden"><h2 className="p-5 font-semibold">Accounts to fund</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-border text-xs text-muted-foreground"><tr><th className="px-5 py-3">Network / role</th><th className="px-5 py-3">Account</th><th className="px-5 py-3 text-right">Balance</th></tr></thead><tbody>{report.accounts.map((a, i) => <tr key={i} className="border-b border-border/60"><td className="px-5 py-4">{a.network}<p className="mt-1 text-xs text-muted-foreground">{a.roles.map((r) => roleLabels[r] ?? r).join(' · ')}</p></td><td className="b-num break-all px-5 py-4 text-xs">{a.address}</td><td className="b-num whitespace-nowrap px-5 py-4 text-right">{formatBaseUnits(a.balance, a.decimals)} {a.symbol}</td></tr>)}</tbody></table></div><p className="p-5 text-xs text-muted-foreground">Balances belong to the recorded block. A nonzero ETH balance does not guarantee enough gas for later actions.</p></section>
        </>}
        {report.kind === 'payments' && <>
          {report.discovery && <section className="b-card p-5"><h2 className="font-semibold">Automatic discovery coverage</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Only the listed finalized ranges were searched. Operation matches are receipt locators; backing is checked separately below. A source hint without a matching credit does not establish an unminted balance.</p>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><p><span className="text-muted-foreground">Paired for audit</span><br /><strong>{report.discovery.paired}</strong></p><p><span className="text-muted-foreground">Source hints awaiting match</span><br /><strong>{report.discovery.pendingSource.length}</strong></p><p><span className="text-muted-foreground">Unmatched destination hints</span><br /><strong>{report.discovery.unmatchedDestination.length}</strong></p></div>
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">{report.discovery.ranges.map((r) => <p key={r.label}>{r.label}: blocks {r.from.toString()}–{r.through.toString()}</p>)}</div>
            {report.discovery.incremental && <div className="mt-4 text-xs text-muted-foreground"><p>{report.discovery.incremental.resumed ? 'Search resumed from the saved journal. Receipts were checked again.' : 'First search saved to the operator journal.'}</p><p className="mt-2">New blocks searched in this run:</p>{report.discovery.incremental.ranges.map((r) => <p key={r.label}>{r.label}: {r.from > r.through ? 'none; saved coverage rechecked' : `blocks ${r.from}–${r.through}`} · {r.remaining.toString()} finalized blocks left to search</p>)}</div>}
            {(report.discovery.pendingSource.length > 0 || report.discovery.unmatchedDestination.length > 0 || report.discovery.conflicts.length > 0) && <details className="mt-4"><summary className="cursor-pointer text-sm">Inspect discovery gaps</summary><ul className="mt-3 space-y-3 text-xs text-muted-foreground">
              {report.discovery.pendingSource.map((h) => <li key={h.operationId} className="break-all">Source operation {short(h.operationId)} · no matching credit in this range<br /><a href={h.explorerUrl} target="_blank" rel="noopener noreferrer" className="underline">{h.transactionHash}</a></li>)}
              {report.discovery.unmatchedDestination.map((h, i) => <li key={`${h.messageId}/${i}`} className="break-all">Destination payment {short(h.messageId)} · {h.reason.replaceAll('-', ' ')}<br /><a href={h.explorerUrl} target="_blank" rel="noopener noreferrer" className="underline">{h.transactionHash}</a></li>)}
              {report.discovery.conflicts.map((id) => <li key={id} className="break-all">Ambiguous operation: {id}. No automatic pairing was selected.</li>)}
            </ul></details>}
          </section>}
          <section className="grid gap-4 sm:grid-cols-3"><Metric label="Listed payments" value={String(report.payments.length)} /><Metric label="Held / unavailable" value={String(report.payments.filter((r) => r.state === 'Held' || r.state === 'Unavailable').length)} /><Metric label="Reported paid / returned" value={String(report.payments.filter((r) => r.state === 'Paid' || r.state === 'Returned').length)} /></section>
          <section className="b-card p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row"><h2 className="font-semibold">Payment queue</h2><div className="flex flex-col gap-3 sm:flex-row"><label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"><Search size={15} /><input aria-label="Search payments by address or identifier" placeholder="Address or payment ID" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 bg-transparent text-sm outline-none" /></label><select aria-label="Filter payments by state" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm"><option>All states</option>{states.map((s) => <option key={s}>{s}</option>)}</select></div></div>
            <div className="mt-5 space-y-3">{visible.map((row) => <Payment key={row.id} row={row} />)}{visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{report.payments.length ? 'No listed payments match this filter.' : 'No requests are listed in this report. This is not a complete treasury inventory.'}</p>}</div>
          </section>
        </>}
        {(report.contracts.length > 0 || report.blocks.length > 0) && <section className="b-card grid gap-6 p-5 lg:grid-cols-2"><div><h2 className="font-semibold">Contract scope</h2>{report.contracts.map((c) => <p key={c.label} className="mt-3 text-sm">{c.label} {c.predicted && <span className="text-xs text-muted-foreground">· predicted, deployment pending</span>}<code className="mt-1 block break-all text-xs text-muted-foreground">{c.address}</code></p>)}</div><div><h2 className="font-semibold">Snapshot anchors</h2>{report.blocks.map((b) => <p key={b.label} className="mt-3 text-sm">{b.label} · block {b.number.toString()}<code className="mt-1 block break-all text-xs text-muted-foreground">{b.hash}</code></p>)}</div></section>}
        {report.notes.length > 0 && <details className="b-card p-5"><summary className="cursor-pointer text-sm font-semibold">Remaining pilot gates</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-xs text-muted-foreground">{report.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></details>}
      </>}
    </main><Footer />
  </div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="b-card p-5"><p className="b-eyebrow">{label}</p><p className="mt-3 break-words text-2xl font-semibold">{value}</p></div>; }
function Payment({ row }: { row: OperationsPayment }) {
  return <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-3"><span className="b-num text-sm">{short(row.id)}</span><span className="rounded-full border border-border px-3 py-1 text-xs font-semibold">{row.state}</span></div><div className="mt-2 flex flex-wrap justify-between gap-2 text-sm"><span className="text-muted-foreground">{row.recipient ? `To ${short(row.recipient)}` : 'Recipient unavailable'}</span><span className="b-num">{row.amount === undefined ? 'Amount unavailable' : `${formatBaseUnits(row.amount, row.decimals)} ${row.symbol}`}</span></div><p className="mt-2 text-xs text-muted-foreground">Backing: reported {row.evidence} · expand evidence</p></summary>
    <ul className="mt-4 list-disc space-y-2 pl-4 text-sm text-muted-foreground">{row.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
    <section className="mt-5 rounded-lg bg-secondary/50 p-4" aria-label="Payment lifecycle">
      <h3 className="text-sm font-semibold">Payment timeline</h3>
      {row.lifecycle?.status === 'reported' ? <>
        <ol className="mt-4 space-y-4 border-l border-border pl-4">{row.lifecycle.milestones.map((step) => <li key={step.label} className="text-sm"><p className="font-medium">{step.label}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(Number(step.time) * 1000).toLocaleString()} · chain block time</p><a href={step.explorerUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block break-all font-mono text-xs underline underline-offset-4">{short(step.hash)}</a></li>)}</ol>
        <div className="mt-5 grid gap-3 text-xs sm:grid-cols-2"><p><span className="text-muted-foreground">Burn → escrow funded</span><br /><strong>{row.lifecycle.settlementSeconds === undefined ? 'Unavailable: chain clocks differ' : formatDuration(row.lifecycle.settlementSeconds)}</strong></p><p><span className="text-muted-foreground">{row.lifecycle.closed ? 'Time in escrow before completion' : 'Time in escrow at snapshot'}</span><br /><strong>{row.lifecycle.escrowSeconds === undefined ? 'Unavailable' : formatDuration(row.lifecycle.escrowSeconds)}</strong></p></div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Receipt milestones are reported by the observer. Block times measure inclusion; they do not measure finality waits or operator response time.{!row.lifecycle.closed && ' This credit has no terminal transaction in this snapshot.'}</p>
      </> : <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{row.lifecycle?.reason ?? 'This older report does not include receipt-backed lifecycle data.'} Refresh the observer report to inspect completion receipts and timing.</p>}
    </section>
    <dl className="mt-4 space-y-3 text-xs"><Detail label="Payment ID" value={row.id} /><Detail label="Business operation" value={row.operationId} /><Detail label="Recipient" value={row.recipient} /><Detail label="Customer policy version" value={row.policyVersion?.toString()} /><Detail label="Current policy hash" value={row.policyHash} /><Detail label="Fixed return recipient" value={row.returnRecipient} /><Detail label="Return requested / maturity" value={row.returnAt && row.returnAt > 0n ? `${new Date(Number(row.returnAt) * 1000).toLocaleString()} (recorded chain clock)` : 'No return requested in this snapshot'} />
      <Detail label="Policy hash in source intent" value={row.intentPolicyHash} />
      {row.transactions.map((t) => <div key={t.label}><dt className="text-muted-foreground">{t.label}</dt><dd className="mt-1 break-all font-mono"><a href={t.explorerUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{t.hash}</a></dd><p className="mt-1 text-muted-foreground">Block {t.block.toString()}</p><code className="block break-all text-muted-foreground">{t.blockHash}</code></div>)}
    </dl>
  </details>;
}
function Detail({ label, value }: { label: string; value?: string }) { return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono">{value ?? 'Not supplied by this report'}</dd></div>; }
