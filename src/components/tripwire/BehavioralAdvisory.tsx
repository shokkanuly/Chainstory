import type { BehavioralAdvisory as Advisory, BehavioralSignalId, BehavioralShadowSignal } from '../../domain/behavioralShadow';

const labels: Record<BehavioralSignalId, string> = {
  size_vs_baseline: 'Transfer size', withdrawal_velocity: 'Recent transfer volume', contract_risk: 'Recipient contract facts',
};
const signalReasons: Record<Extract<BehavioralShadowSignal, { status: 'unavailable' }>['reason'], string> = {
  'not-reported': 'Signal was not supplied.', 'invalid-signal': 'Signal data was unusable.',
  'stale-assessment': 'Assessment is too old.', 'future-assessment': 'Assessment clock needs checking.',
};
const advisoryReasons: Record<Extract<Advisory, { status: 'unavailable' }>['reason'], string> = {
  'assessment-not-produced': 'This observer did not calculate behavioral signals.',
  'invalid-input': 'Assessment data was unusable.', 'scope-mismatch': 'Assessment did not match this payment.',
};

export default function BehavioralAdvisory({ advisory, nowMs }: { advisory?: Advisory; nowMs: number }) {
  const assessment = advisory?.status === 'reported' ? advisory.assessment : undefined;
  const now = Math.floor(nowMs / 1000);
  // Never revive scores suppressed at export, or make capture newer on reload.
  const freshness = assessment ? assessment.freshness !== 'current' ? assessment.freshness
    : !Number.isFinite(now) || now < assessment.checkedAt || now < assessment.capturedAt ? 'future'
    : now - assessment.capturedAt > assessment.maxAgeSeconds ? 'stale' : 'current' : undefined;
  return <section className="mt-5 rounded-lg border border-border p-4" aria-label="Behavioral signals — advisory only">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Behavioral signals</h3>
      <span className="rounded-full border border-border px-2 py-1 text-xs">Advisory only</span></div>
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">These signals do not approve a payment. Existing payout checks remain in force.</p>
    {assessment ? <>
      <p className="mt-3 text-xs text-muted-foreground">Assessment captured {new Date(assessment.capturedAt * 1000).toLocaleString()} · {freshness === 'current' ? `${Math.max(0, now - assessment.capturedAt)} seconds old` : freshness === 'stale' ? 'Too old to show scores' : 'Check assessment clock'}{assessment.synthetic && ' · Synthetic example'}</p>
      <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-3">{assessment.signals.map((signal) => <div key={signal.id}>
        <dt className="text-muted-foreground">{labels[signal.id]}</dt>
        <dd className="mt-1 font-medium">{freshness !== 'current' ? `Unavailable: ${freshness === 'stale' ? signalReasons['stale-assessment'] : signalReasons['future-assessment']}`
          : signal.status === 'reported' ? `Indicator ${signal.score.toFixed(2)} / 1` : `Unavailable: ${signalReasons[signal.reason]}`}</dd>
      </div>)}</dl>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Indicators copy the existing scorer output. They are not probabilities of loss or evidence that a payment is safe. This imported report does not authenticate the assessment source.</p>
    </> : <p className="mt-3 text-xs text-muted-foreground">Unavailable: {advisory?.status === 'unavailable' ? advisoryReasons[advisory.reason] : 'This report does not include behavioral signals.'}</p>}
  </section>;
}
