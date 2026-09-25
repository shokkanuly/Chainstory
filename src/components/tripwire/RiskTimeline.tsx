// src/components/tripwire/RiskTimeline.tsx
//
// One column per release, height = the oracle's risk score, coloured by its
// verdict, against the trip threshold. Built to the dataviz specs: columns at
// most 24px with a rounded data-end and a square base, a 2px surface gap,
// hairline recessive axes, direct labels only on the trips (the extreme the
// story is about), and a tooltip on hover and on keyboard focus. The event
// table beside it is the table view, so nothing here is hover-gated.

import { useLayoutEffect, useRef, useState } from 'react';
import type { StepRecord } from '@/tripwire/replay/engine';
import type { IncidentEvent } from '@/tripwire/replay/incidents';
import { clock, usd } from '@/tripwire/replay/format';
import { DEFAULT_CONFIG } from '@/tripwire/riskScorer';
import { VERDICT_COLOR, VERDICT_LABEL } from './verdict';

const HEIGHT = 196;
const PAD = { top: 20, right: 14, bottom: 24, left: 34 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;
const THRESHOLD = DEFAULT_CONFIG.tripThreshold;

/** A column with a rounded data-end and a square base. */
function columnPath(x: number, bottom: number, w: number, h: number) {
  const r = Math.min(RADIUS, w / 2, h);
  const top = bottom - h;
  return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
}

export default function RiskTimeline({ events, steps }: { events: IncidentEvent[]; steps: StepRecord[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const bottom = PAD.top + plotH;
  const slot = plotW / Math.max(1, events.length);
  const barW = Math.max(3, Math.min(MAX_BAR, slot - GAP));
  const xOf = (i: number) => PAD.left + i * slot + (slot - barW) / 2;
  const yOf = (score: number) => bottom - score * plotH;
  const last = events[events.length - 1];
  const hovered = active === null ? null : steps[active];

  return (
    <div ref={box} className="relative select-none">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Risk score for each of ${steps.length} of ${events.length} releases, against a trip threshold of ${THRESHOLD}`}
        className="block overflow-visible"
      >
        {/* Recessive grid: the ceiling and the midline. */}
        {[1, 0.5].map((v) => (
          <line key={v} x1={PAD.left} x2={width - PAD.right} y1={yOf(v)} y2={yOf(v)} stroke="var(--b-line)" strokeWidth={1} />
        ))}
        {[0, 0.5, 1].map((v) => (
          <text key={v} x={PAD.left - 8} y={yOf(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--b-text-faint)" className="b-num">
            {v.toFixed(1)}
          </text>
        ))}

        {/* The trip threshold: the one reference that matters. */}
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={yOf(THRESHOLD)}
          y2={yOf(THRESHOLD)}
          stroke="var(--b-text-muted)"
          strokeWidth={1}
        />
        {/* Left, over the pre-incident traffic, which never nears the threshold;
            the attack lands on the right and used to cover this label. The
            surface-coloured halo keeps it legible even if a bar reaches it. */}
        <text
          x={PAD.left + 4}
          y={yOf(THRESHOLD) - 5}
          fontSize={10.5}
          fontWeight={600}
          fill="var(--b-text-muted)"
          stroke="var(--b-canvas)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          Trip threshold {THRESHOLD.toFixed(2)}
        </text>

        {/* Releases still to come: a faint tick, so the length of the incident is visible. */}
        {events.map((_, i) =>
          i >= steps.length ? (
            <rect key={`u${i}`} x={xOf(i)} y={bottom - 1} width={barW} height={1} fill="var(--b-line-strong)" />
          ) : null
        )}

        {steps.map((s, i) => {
          const score = s.assessment.score ?? 0;
          const h = Math.max(2, score * plotH);
          return (
            <path
              key={i}
              d={columnPath(xOf(i), bottom, barW, h)}
              fill={VERDICT_COLOR[s.assessment.verdict]}
              opacity={active === null || active === i ? 1 : 0.45}
            />
          );
        })}

        {/* Selective direct labels: the trips only. */}
        {steps.map((s, i) =>
          s.assessment.verdict === 'trip' && s.assessment.score !== null ? (
            <text
              key={`l${i}`}
              x={xOf(i) + barW / 2}
              y={yOf(s.assessment.score) - 6}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="var(--b-text)"
              className="b-num"
            >
              {s.assessment.score.toFixed(2)}
            </text>
          ) : null
        )}

        <line x1={PAD.left} x2={width - PAD.right} y1={bottom} y2={bottom} stroke="var(--b-line-strong)" strokeWidth={1} />
        <text x={PAD.left} y={HEIGHT - 6} fontSize={10} fill="var(--b-text-faint)" className="b-num">
          {clock(0)}
        </text>
        {last && (
          <text x={width - PAD.right} y={HEIGHT - 6} textAnchor="end" fontSize={10} fill="var(--b-text-faint)" className="b-num">
            {clock(last.t)}
          </text>
        )}

        {/* Hit targets: the whole slot, bigger than the mark, focusable. */}
        {steps.map((s, i) => (
          <rect
            key={`h${i}`}
            x={PAD.left + i * slot}
            y={PAD.top}
            width={slot}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${clock(s.event.t)}, ${s.event.label}: risk ${s.assessment.score?.toFixed(2) ?? 'not assessed'}, ${VERDICT_LABEL[s.assessment.verdict]}`}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="cursor-default outline-none focus-visible:[stroke:var(--b-text-muted)] focus-visible:[stroke-width:1]"
          />
        ))}
      </svg>

      {hovered && active !== null && (
        <Tooltip
          step={hovered}
          left={Math.min(Math.max(xOf(active) + barW / 2, 110), width - 110)}
          top={yOf(hovered.assessment.score ?? 0)}
        />
      )}

      {steps.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-sm text-muted-foreground">
          Press play to stream the incident.
        </p>
      )}
    </div>
  );
}

/** Value leads, label follows; keyed with a short line in the verdict colour. */
function Tooltip({ step, left, top }: { step: StepRecord; left: number; top: number }) {
  const v = step.assessment.verdict;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 w-[220px] -translate-x-1/2 -translate-y-full rounded-lg border px-3 py-2 text-xs shadow-sm"
      style={{ left, top: Math.max(top - 10, 60), background: 'var(--b-raised)', borderColor: 'var(--b-line-strong)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="b-num text-base font-semibold text-foreground">
          {step.assessment.score === null ? '—' : step.assessment.score.toFixed(2)}
        </span>
        <span className="b-num text-muted-foreground">{clock(step.event.t)}</span>
      </div>
      <div className="mt-0.5 text-foreground">{step.event.label}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-muted-foreground">
        <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: VERDICT_COLOR[v] }} />
        {VERDICT_LABEL[v]} · {usd(step.event.amountUsd)}
      </div>
    </div>
  );
}
