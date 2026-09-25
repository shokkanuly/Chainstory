// src/components/tripwire/TripwireDashboard.tsx
//
// The incident replay. Everything on this page comes from real calls: the
// oracle scores each release, and two deployments of the compiled guardian —
// one that acts before execution, one after inclusion — accept or block it.
//
// Honesty is part of the design, not a footnote. Each incident's sourced
// facts and its assumptions are shown side by side, and the post-inclusion
// result is shown next to the pre-execution one even though it loses every
// time: all three of these exploits drained in a single release.

import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  GaugeIcon,
  InfoIcon,
  LightningIcon,
  PauseIcon,
  PlayIcon,
  ProhibitIcon,
  QuestionIcon,
  SkipForwardIcon,
  WarningIcon,
  type Icon,
} from '@phosphor-icons/react';
import './tripwire.css';
import RiskTimeline from './RiskTimeline';
import { VERDICT_COLOR, VERDICT_LABEL } from './verdict';
import { useReplay } from './useReplay';
import { BLOCK_SECONDS, INCIDENTS, YEAR_TO_DATE, type Incident } from '@/tripwire/replay/incidents';
import type { ReplaySnapshot, RouteStatus, RouteView, Strategy } from '@/tripwire/replay/engine';
import type { ControllerState, ReplayController } from '@/tripwire/replay/controller';
import { clock, reportDate, usd } from '@/tripwire/replay/format';
import type { Verdict } from '@/tripwire/types';
import { DURATION, EASE, useReducedMotion } from '@/lib/motion';

const SPEEDS = [
  { label: '0.5×', ms: 1400 },
  { label: '1×', ms: 700 },
  { label: '2×', ms: 350 },
  { label: '4×', ms: 175 },
];

const STRATEGY_LABEL: Record<Strategy, string> = { pre: 'Before execution', post: 'After inclusion' };

const VERDICT_ICON: Record<Verdict, Icon> = {
  clear: CheckCircleIcon,
  elevated: WarningIcon,
  trip: LightningIcon,
  indeterminate: QuestionIcon,
};

const ROUTE_STATUS: Record<RouteStatus, { label: string; color: string; icon: Icon }> = {
  ACTIVE: { label: 'Active', color: 'var(--tw-clear)', icon: CheckCircleIcon },
  RATE_LIMITED: { label: 'Rate limited', color: 'var(--tw-elevated)', icon: WarningIcon },
  PAUSED: { label: 'Paused', color: 'var(--tw-trip)', icon: ProhibitIcon },
};

export default function TripwireDashboard() {
  const [params, setParams] = useSearchParams();
  const initial = INCIDENTS.find((i) => i.id === params.get('incident'))?.id ?? 'kelp';
  const [state, controller] = useReplay(initial);
  const incident = INCIDENTS.find((i) => i.id === state.incidentId)!;
  const snap = state.replay;

  const select = (id: Incident['id']) => {
    if (id === state.incidentId && state.status !== 'error') return;
    setParams({ incident: id }, { replace: true });
    void controller.select(id);
  };

  useKeyboard(state, controller);

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="b-eyebrow">Tripwire · incident replay</p>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Would it have stopped them?</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          By mid-May 2026, bridge exploits had cost ${(YEAR_TO_DATE.lossUsd / 1e6).toFixed(1)}M across at least{' '}
          {YEAR_TO_DATE.exploits} hacks. Replay three of them through Tripwire’s risk oracle and the real guardian
          contract, and see exactly where a circuit breaker helps — and where it can’t.
        </p>
      </header>

      <IncidentPicker selected={state.incidentId} onSelect={select} />

      <Outcomes incident={incident} snap={snap} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <section className="b-card p-4 sm:p-5">
            <Controls state={state} controller={controller} events={incident.events.length} />
            <Legend />
            <div className="mt-2">
              <RiskTimeline events={incident.events} steps={snap?.steps ?? []} />
            </div>
          </section>
          <EventFeed incident={incident} snap={snap} />
        </div>
        <aside className="min-w-0 space-y-6">
          <TripCard incident={incident} snap={snap} />
          <RouteMatrix snap={snap} />
        </aside>
      </div>

      <Evidence incident={incident} />

      <p className="text-xs leading-relaxed text-muted-foreground">
        Runs the compiled TripwireGuardian bytecode in a local EVM inside your browser, signed with throwaway demo
        keys. Nothing here touches a real chain. Keyboard: <kbd className="b-num">Space</kbd> play or pause ·{' '}
        <kbd className="b-num">→</kbd> step · <kbd className="b-num">R</kbd> reset.
      </p>
    </div>
  );
}

// --- incident picker ------------------------------------------------------------

function IncidentPicker({ selected, onSelect }: { selected: Incident['id']; onSelect: (id: Incident['id']) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" aria-label="Incident">
      {INCIDENTS.map((i) => {
        const active = i.id === selected;
        return (
          <button
            key={i.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(i.id)}
            // One compact row on a phone, so the comparison below is not a screen away.
            className="b-card flex items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 sm:block sm:p-4"
            style={{ borderColor: active ? 'var(--b-text)' : undefined, boxShadow: active ? 'inset 0 0 0 1px var(--b-text)' : undefined }}
          >
            <span className="min-w-0">
              <span className="b-eyebrow">{reportDate(i.date)}</span>
              <span className="mt-0.5 block truncate font-semibold sm:mt-1">{i.name}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2 sm:mt-2">
              <span className="b-num text-lg font-semibold">{usd(i.reportedLossUsd)}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">reported loss</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// --- the comparison ------------------------------------------------------------------

function Outcomes({ incident, snap }: { incident: Incident; snap: ReplaySnapshot | null }) {
  const steps = snap?.steps ?? [];
  const realityLost = steps
    .filter((s) => s.event.kind !== 'legit' && !s.event.stoppedInReality)
    .reduce((sum, s) => sum + s.event.amountUsd, 0);

  const tile = (strategy: Strategy) => {
    const t = snap?.totals[strategy];
    const tripped = Boolean(snap?.trips[strategy]);
    const lost = t?.lostUsd ?? 0;
    const status: Status = lost > 0 ? 'drained' : tripped ? 'protected' : 'watching';
    return (
      <Tile
        label={`Tripwire · ${STRATEGY_LABEL[strategy].toLowerCase()}`}
        value={usd(lost)}
        status={status}
        note={
          t && t.heldLegitCount > 0
            ? `${t.heldLegitCount} honest withdrawal${t.heldLegitCount === 1 ? '' : 's'} (${usd(t.heldLegitUsd)}) held for review — the cost of pausing.`
            : strategy === 'pre'
              ? 'Scores each release before it executes.'
              : `Reacts after inclusion; its attestation lands ${BLOCK_SECONDS}s later.`
        }
      />
    );
  };

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile
        label="What actually happened"
        value={usd(realityLost)}
        status={realityLost > 0 ? 'drained' : 'watching'}
        note={`Reported loss ${usd(incident.reportedLossUsd)}${incident.reportedLossDetail ? ` · ${incident.reportedLossDetail}` : ''}.`}
      />
      {tile('pre')}
      {tile('post')}
    </div>
  );
}

type Status = 'watching' | 'protected' | 'drained';
const STATUS: Record<Status, { label: string; color: string; icon: Icon }> = {
  watching: { label: 'Watching', color: 'var(--b-text-faint)', icon: GaugeIcon },
  protected: { label: 'Nothing lost', color: 'var(--tw-clear)', icon: CheckCircleIcon },
  drained: { label: 'Drained', color: 'var(--tw-trip)', icon: ProhibitIcon },
};

function Tile({ label, value, status, note }: { label: string; value: string; status: Status; note: string }) {
  const s = STATUS[status];
  return (
    <div className="b-card p-4">
      {/* The label gets its own line and the pill sits beside the value, so
          the three values line up across tiles — they are the comparison. */}
      <span className="block truncate text-[13px] text-muted-foreground" title={label}>
        {label}
      </span>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-3xl font-semibold tracking-[-0.02em]" aria-live="polite">
          {value}
        </span>
        <Pill color={s.color} icon={s.icon}>
          {s.label}
        </Pill>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}

/** Status is carried by the icon and the label; the colour only reinforces it. */
function Pill({ color, icon: IconC, children }: { color: string; icon: Icon; children: ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-foreground"
      style={{ borderColor: `color-mix(in oklab, ${color} 45%, transparent)` }}
    >
      <IconC size={12} weight="bold" color={color} aria-hidden />
      {children}
    </span>
  );
}

// --- controls -------------------------------------------------------------------------

function Controls({ state, controller, events }: { state: ControllerState; controller: ReplayController; events: number }) {
  const { status, replay } = state;
  const primary = () => {
    if (status === 'playing') controller.pause();
    else if (status === 'done' || status === 'error') void controller.reset().then(() => controller.start());
    else controller.start();
  };
  const primaryLabel =
    status === 'loading'
      ? 'Deploying guardian…'
      : status === 'playing'
        ? 'Pause'
        : status === 'done'
          ? 'Replay'
          : status === 'error'
            ? 'Try again'
            : replay && replay.cursor > 0
              ? 'Resume'
              : 'Play';
  const PrimaryIcon = status === 'loading' ? CircleNotchIcon : status === 'playing' ? PauseIcon : status === 'done' ? ArrowCounterClockwiseIcon : PlayIcon;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={primary}
          disabled={status === 'loading'}
          className="b-btn b-btn--primary disabled:opacity-60"
          style={{ padding: '0.625rem 1.1rem' }}
        >
          <PrimaryIcon size={15} weight="fill" className={status === 'loading' ? 'animate-spin' : undefined} aria-hidden />
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={() => void controller.step()}
          disabled={status !== 'ready'}
          className="b-btn b-btn--ghost disabled:opacity-40"
          style={{ padding: '0.625rem 1rem' }}
        >
          <SkipForwardIcon size={15} weight="bold" aria-hidden />
          Step
        </button>
        <button
          type="button"
          onClick={() => void controller.reset()}
          disabled={status === 'loading'}
          aria-label="Reset replay"
          className="b-btn b-btn--ghost disabled:opacity-40"
          style={{ padding: '0.625rem 0.75rem' }}
        >
          <ArrowCounterClockwiseIcon size={15} weight="bold" aria-hidden />
        </button>

        <div className="flex rounded-full border border-border p-0.5" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s.ms}
              type="button"
              aria-pressed={state.speedMs === s.ms}
              onClick={() => controller.setSpeed(s.ms)}
              className="b-num rounded-full px-2.5 py-1 text-xs text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>

        <span className="b-num ml-auto text-xs text-muted-foreground">
          {clock(replay?.clock ?? 0)} · {replay?.cursor ?? 0}/{events}
        </span>
      </div>

      {status === 'error' && (
        <p role="alert" className="mt-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--tw-trip)' }}>
          The replay stopped: {state.error}
        </p>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(['clear', 'elevated', 'trip'] as Verdict[]).map((v) => (
        <span key={v} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: VERDICT_COLOR[v] }} />
          {VERDICT_LABEL[v]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-px w-4" style={{ background: 'var(--b-text-muted)' }} />
        Trip threshold
      </span>
    </div>
  );
}

// --- the trip moment -------------------------------------------------------------------

function TripCard({ incident, snap }: { incident: Incident; snap: ReplaySnapshot | null }) {
  const reduced = useReducedMotion();
  const pre = snap?.trips.pre;
  const post = snap?.trips.post;
  const trigger = pre ? snap!.steps[pre.triggerIndex] : undefined;
  const reason = trigger?.assessment.signals.find((s) => s.deterministic && s.score > 0)?.reason;

  return (
    <section aria-live="polite" className="b-card overflow-hidden" style={{ borderColor: pre ? 'var(--tw-trip)' : undefined }}>
      <AnimatePresence mode="wait" initial={false}>
        {!pre ? (
          <motion.div key="armed" className="p-5" exit={reduced ? undefined : { opacity: 0 }}>
            <p className="b-eyebrow flex items-center gap-1.5">
              <GaugeIcon size={13} weight="bold" aria-hidden /> Breaker armed
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Scoring every release against the route’s baseline and, independently, against the burn behind it.
              Nothing has reached the {`0.75`} trip threshold.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="tripped"
            className="p-5"
            initial={reduced ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: DURATION.base, ease: EASE }}
          >
            <p className="b-eyebrow flex items-center gap-1.5" style={{ color: 'var(--b-text)' }}>
              <LightningIcon size={13} weight="fill" color="var(--tw-trip)" aria-hidden /> Breaker tripped
            </p>
            <h3 className="mt-2 text-lg font-semibold leading-snug">Route paused before the release executed.</h3>
            {reason && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{reason}</p>}

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Attestation landed</dt>
              <dd className="b-num">{clock(pre.landedAt)}, same block</dd>
              <dt className="text-muted-foreground">Risk score</dt>
              <dd className="b-num">
                {(Number(pre.riskScore) / 100).toFixed(2)} · {String(pre.riskScore)} on-chain
              </dd>
              <dt className="text-muted-foreground">Gas</dt>
              <dd className="b-num">{pre.gas.toLocaleString('en-US')}</dd>
              <dt className="text-muted-foreground">Score, sign, submit</dt>
              <dd className="b-num">{pre.computeMs.toFixed(1)} ms on this device</dd>
            </dl>

            <div className="mt-4 border-t border-border pt-3 text-sm leading-relaxed">
              <p className="font-medium">After inclusion</p>
              <p className="mt-0.5 text-muted-foreground">
                {post
                  ? `The same trip landed at ${clock(post.landedAt)}, one block later — after ${usd(snap!.totals.post.lostUsd)} had already left. A breaker that waits for inclusion cannot stop a single-release drain.`
                  : `Waiting one block (${BLOCK_SECONDS}s) for the release to be included…`}
              </p>
            </div>

            <div className="mt-3 border-t border-border pt-3 text-sm leading-relaxed">
              <p className="font-medium">What actually happened</p>
              <p className="mt-0.5 text-muted-foreground">{incident.aftermath}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// --- route isolation ---------------------------------------------------------------------

function RouteMatrix({ snap }: { snap: ReplaySnapshot | null }) {
  const [view, setView] = useState<Strategy>('pre');
  const routes: RouteView[] = snap?.routes[view] ?? [];
  return (
    <section className="b-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Routes</h3>
        <div className="flex rounded-full border border-border p-0.5 text-[11px]" role="group" aria-label="Guardian">
          {(['pre', 'post'] as Strategy[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={view === s}
              onClick={() => setView(s)}
              className="rounded-full px-2.5 py-1 text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
            >
              {STRATEGY_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Only the attacked route pauses. The rest of the bridge keeps running.</p>

      <ul className="mt-4 divide-y divide-border">
        {routes.map((r) => {
          const st = ROUTE_STATUS[r.status];
          return (
            <li key={r.key} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {r.chainLabel} <span className="text-muted-foreground">· {r.routeLabel}</span>
                </p>
                <p className="b-num mt-0.5 text-xs text-muted-foreground">
                  {usd(r.windowOutflowUsd)} out this window
                  {r.pausedUntil !== null && ` · resumes ${clock(r.pausedUntil)}`}
                </p>
              </div>
              <Pill color={st.color} icon={st.icon}>
                {st.label}
              </Pill>
            </li>
          );
        })}
        {routes.length === 0 && <li className="py-3 text-sm text-muted-foreground">Deploying…</li>}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Rate caps are off in this replay, so what you see is the oracle’s effect alone.
      </p>
    </section>
  );
}

// --- the table view -----------------------------------------------------------------------

function EventFeed({ incident, snap }: { incident: Incident; snap: ReplaySnapshot | null }) {
  const steps = [...(snap?.steps ?? [])].reverse();
  return (
    <section className="b-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4 sm:px-5">
        <h3 className="font-semibold">Releases</h3>
        <span className="text-xs text-muted-foreground">
          {steps.length} of {incident.events.length} · newest first
        </span>
      </div>
      <div className="mt-3 max-h-[440px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] text-left text-[11px] uppercase tracking-wider text-muted-foreground" style={{ background: 'var(--b-canvas)' }}>
            <tr className="border-b border-border">
              <th className="px-4 py-2 font-semibold sm:px-5">Time</th>
              <th className="py-2 pr-3 font-semibold">Release</th>
              <th className="hidden py-2 pr-3 text-right font-semibold sm:table-cell">Risk</th>
              <th className="hidden py-2 pr-3 font-semibold sm:table-cell">Verdict</th>
              <th className="py-2 pr-3 font-semibold">Before exec.</th>
              <th className="hidden py-2 pr-4 font-semibold sm:table-cell sm:pr-5">After incl.</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const attack = s.event.kind !== 'legit';
              const V = VERDICT_ICON[s.assessment.verdict];
              return (
                <tr
                  key={s.index}
                  className="border-b border-border/60 align-top"
                  style={attack ? { background: 'color-mix(in oklab, var(--tw-trip) 7%, transparent)' } : undefined}
                >
                  <td className="b-num whitespace-nowrap px-4 py-2 text-xs text-muted-foreground sm:px-5">{clock(s.event.t)}</td>
                  <td className="py-2 pr-3">
                    <span className={attack ? 'font-medium' : undefined}>{s.event.label}</span>
                    {s.event.sourced && (
                      <span
                        className="ml-1.5 inline-flex items-center gap-0.5 whitespace-nowrap align-middle text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        title={s.event.sourced}
                      >
                        <InfoIcon size={11} weight="bold" aria-hidden /> Reported
                      </span>
                    )}
                    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground sm:hidden">
                      <V size={12} weight="bold" color={VERDICT_COLOR[s.assessment.verdict]} aria-hidden />
                      {VERDICT_LABEL[s.assessment.verdict]} · {s.assessment.score?.toFixed(2) ?? '—'}
                    </span>
                  </td>
                  <td className="b-num hidden py-2 pr-3 text-right sm:table-cell">{s.assessment.score?.toFixed(2) ?? '—'}</td>
                  <td className="hidden py-2 pr-3 sm:table-cell">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <V size={13} weight="bold" color={VERDICT_COLOR[s.assessment.verdict]} aria-hidden />
                      {VERDICT_LABEL[s.assessment.verdict]}
                    </span>
                  </td>
                  <OutcomeCell outcome={s.outcome.pre} attack={attack} />
                  <OutcomeCell outcome={s.outcome.post} attack={attack} className="hidden sm:table-cell" last />
                </tr>
              );
            })}
            {steps.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No releases yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OutcomeCell({ outcome, attack, className = '', last }: { outcome: 'released' | 'blocked'; attack: boolean; className?: string; last?: boolean }) {
  return (
    <td className={`py-2 text-xs ${last ? 'pr-4 sm:pr-5' : 'pr-3'} ${className}`}>
      {outcome === 'blocked' ? (
        <span className="inline-flex items-center gap-1 font-medium">
          <ProhibitIcon size={12} weight="bold" color="var(--tw-clear)" aria-hidden /> Blocked
        </span>
      ) : (
        <span className={attack ? 'font-semibold text-foreground' : 'text-muted-foreground'}>Released</span>
      )}
    </td>
  );
}

// --- evidence ------------------------------------------------------------------------------

function Evidence({ incident }: { incident: Incident }) {
  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="b-card p-5">
        <p className="b-eyebrow">What the bridge failed to check</p>
        <p className="mt-1.5 text-sm leading-relaxed">{incident.mechanism}</p>
        <p className="b-eyebrow mt-5">What happened next</p>
        <p className="mt-1.5 text-sm leading-relaxed">{incident.aftermath}</p>
        <p className="b-eyebrow mt-5">Sources</p>
        <ul className="mt-1.5 space-y-1 text-sm">
          {incident.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-border underline-offset-4 hover:decoration-current">
                {s.label} <ArrowSquareOutIcon size={12} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Figures as reported at the linked pages, checked 25 Sep 2026.</p>
      </div>

      <div className="b-card p-5">
        <p className="b-eyebrow">A reconstruction, not a recording</p>
        <p className="mt-1.5 text-sm leading-relaxed">
          This replays what the attack looked like to the bridge, not its literal on-chain transactions — there are no real
          hashes here. Events marked <span className="font-semibold">Reported</span> reproduce what the sources describe;
          everything else is illustrative background traffic. The outcome depends only on the reported mechanism: a payout
          with no verifiable burn behind it.
        </p>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">{incident.assumptions.length} assumptions behind this replay</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed text-muted-foreground">
            {incident.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}

// --- keyboard -------------------------------------------------------------------------------

function useKeyboard(state: ControllerState, controller: ReplayController) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(target.tagName) || target.isContentEditable)) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (state.status === 'playing') controller.pause();
        else if (state.status === 'ready') controller.start();
      } else if (e.key === 'ArrowRight' && state.status === 'ready') {
        void controller.step();
      } else if (e.key.toLowerCase() === 'r' && state.status !== 'loading') {
        void controller.reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.status, controller]);
}
