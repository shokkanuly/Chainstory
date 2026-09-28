// The landing page's bridge to Tripwire. Figures come from the same incident
// data the replay runs on; the $0 and full-loss outcomes are asserted by the
// replay tests, so this band cannot drift from what the replay shows.

import { INCIDENTS } from '@/tripwire/replay/incidents';
import { reportDate, usd } from '@/tripwire/replay/format';

const kelp = INCIDENTS.find((i) => i.id === 'kelp')!;

const ROWS = [
  { label: 'What actually happened', value: usd(kelp.reportedLossUsd) },
  { label: 'Tripwire, before execution', value: '$0', strong: true },
  { label: 'Tripwire, one block later', value: usd(kelp.reportedLossUsd) },
];

export default function TripwireTeaser() {
  return (
    <section id="tripwire" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="b-card grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_minmax(0,420px)] lg:items-center">
        <div>
          <p className="b-eyebrow">Also from Retold · Tripwire</p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] sm:text-3xl">A circuit breaker for bridges.</h2>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Retold reads what a transaction did. Tripwire checks a bridge payout before it executes: is it backed by a
            burn we can verify? If not, it pauses that one route. Every major bridge drain of 2026 was a single
            transaction — so acting afterwards is too late.
          </p>
          <a href="/tripwire?incident=kelp" className="b-btn b-btn--primary mt-6">
            Watch the Kelp DAO replay →
          </a>
        </div>
        <dl className="divide-y divide-border rounded-xl border border-border">
          <div className="px-5 py-3 text-xs text-muted-foreground">
            {kelp.name} · {reportDate(kelp.date)}
          </div>
          {ROWS.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-4 px-5 py-3">
              <dt className="text-sm text-muted-foreground">{r.label}</dt>
              <dd className={`text-2xl tracking-[-0.02em] ${r.strong ? 'font-bold' : 'font-semibold'}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
