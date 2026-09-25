// Each incident replayed end to end through the real oracle and the real
// guardian bytecode. The assertions are the claims the dashboard makes, so a
// change that would make the dashboard say something false fails here first.

import { describe, expect, it } from 'vitest';
import { IncidentReplay, type ReplaySnapshot } from '../engine.js';
import { ReplayController } from '../controller.js';
import { BLOCK_SECONDS, INCIDENTS, type Incident } from '../incidents.js';

async function runToEnd(incident: Incident): Promise<ReplaySnapshot> {
  const replay = await IncidentReplay.create(incident);
  while ((await replay.step()) !== null);
  return replay.snapshot();
}

const firstAttack = (i: Incident) => i.events.findIndex((e) => e.kind !== 'legit');

describe.each(INCIDENTS.map((i) => [i.id, i] as const))('%s', (_id, incident) => {
  let snap: ReplaySnapshot;
  const exploit = () => incident.events[firstAttack(incident)];

  it('replays to the end', async () => {
    snap = await runToEnd(incident);
    expect(snap.done).toBe(true);
    expect(snap.steps).toHaveLength(incident.events.length);
  });

  it('reproduces the reported loss when nothing intervenes', () => {
    expect(snap.realityLostUsd).toBe(incident.reportedLossUsd);
  });

  // A breaker that trips on ordinary traffic would pause bridges for nothing.
  it('never trips on a legitimate withdrawal', () => {
    for (const step of snap.steps.filter((s) => s.event.kind === 'legit')) {
      expect(step.assessment.verdict, step.event.label).not.toBe('trip');
    }
  });

  it('trips on the exploit itself, as proof rather than an estimate', () => {
    const step = snap.steps[firstAttack(incident)];
    expect(step.assessment.verdict).toBe('trip');
    expect(step.onChainScore).toBe(100n);
    expect(step.assessment.signals.find((s) => s.id === 'proof_payout_mismatch')?.deterministic).toBe(true);
  });

  it('pre-execution: pauses before the release, and nothing is lost', () => {
    expect(snap.trips.pre?.triggerIndex).toBe(firstAttack(incident));
    expect(snap.trips.pre?.landedAt).toBe(exploit().t);
    expect(snap.totals.pre.lostUsd).toBe(0);
    expect(snap.steps[firstAttack(incident)].outcome.pre).toBe('blocked');
  });

  // The honest half. Every one of these drained in a single release, which a
  // breaker that reacts after inclusion cannot stop.
  it('post-inclusion: cannot stop the release that tripped it', () => {
    expect(snap.steps[firstAttack(incident)].outcome.post).toBe('released');
    expect(snap.trips.post?.landedAt).toBe(exploit().t + BLOCK_SECONDS);
    expect(snap.totals.post.lostUsd).toBe(exploit().amountUsd);
  });

  it('pauses only the incident route', () => {
    for (const s of ['pre', 'post'] as const) {
      const [route, ...idle] = snap.routes[s];
      expect(route.incident).toBe(true);
      expect(route.status).toBe('PAUSED');
      expect(idle.map((r) => r.status)).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE']);
    }
  });

  // The cost of pausing: honest users on the same route wait for review.
  it('holds the legitimate withdrawals that arrive during the pause', () => {
    const after = incident.events.filter((e) => e.kind === 'legit' && e.t >= exploit().t);
    expect(snap.totals.pre.heldLegitCount).toBe(after.length);
    expect(snap.totals.pre.heldLegitUsd).toBe(after.reduce((sum, e) => sum + e.amountUsd, 0));
  });
});

describe('kelp follow-up', () => {
  it('the second forged packet is blocked under either strategy', async () => {
    const snap = await runToEnd(INCIDENTS.find((i) => i.id === 'kelp')!);
    const followUp = snap.steps.find((s) => s.event.kind === 'follow_up')!;
    expect(followUp.outcome).toEqual({ pre: 'blocked', post: 'blocked' });
  });
});

describe('determinism', () => {
  it('two replays of the same incident produce identical outcomes', async () => {
    const [a, b] = await Promise.all([runToEnd(INCIDENTS[0]), runToEnd(INCIDENTS[0])]);
    const shape = (s: ReplaySnapshot) =>
      s.steps.map((x) => [x.event.t, x.assessment.verdict, x.onChainScore, x.outcome.pre, x.outcome.post]);
    expect(shape(a)).toEqual(shape(b));
    expect(a.totals).toEqual(b.totals);
  });
});

describe('controller', () => {
  it('loads, steps, plays, pauses and resets', async () => {
    const c = new ReplayController('syscoin', 0);
    await c.select('syscoin');
    expect(c.getSnapshot().status).toBe('ready');

    await c.step();
    expect(c.getSnapshot().replay?.cursor).toBe(1);

    c.setSpeed(0);
    c.start();
    expect(c.getSnapshot().status).toBe('playing');
    await new Promise((r) => setTimeout(r, 30));
    c.pause();
    await c.step(); // drain whatever the loop had queued
    const paused = c.getSnapshot().replay!.cursor;
    expect(c.getSnapshot().status).toBe('ready');
    expect(paused).toBeGreaterThan(1);

    await c.reset();
    expect(c.getSnapshot().replay?.cursor).toBe(0);
  });

  it('switching incident mid-load discards the stale one', async () => {
    const c = new ReplayController('verus', 0);
    const first = c.select('verus');
    const second = c.select('kelp');
    await Promise.all([first, second]);
    expect(c.getSnapshot().incidentId).toBe('kelp');
    expect(c.getSnapshot().replay?.incident.id).toBe('kelp');
  });
});

import { clock, reportDate, usd } from '../format.js';

describe('display formatting', () => {
  it.each([
    [292_000_000, '$292M'],
    [11_580_000, '$11.58M'],
    [10_000_000, '$10M'],
    [95_000_000, '$95M'],
    [81_710, '$81.7K'],
    [169_300, '$169.3K'],
    [328_600_000, '$329M'],
    [940, '$940'],
    [0, '$0'],
  ])('usd(%s) = %s', (n, s) => expect(usd(n)).toBe(s));

  it.each([
    [0, 'T+00:00'],
    [671, 'T+11:11'],
    [3725, 'T+1:02:05'],
  ])('clock(%s) = %s', (n, s) => expect(clock(n)).toBe(s));

  it('formats report dates without depending on the viewer’s timezone', () => {
    expect(reportDate('2026-04-18')).toBe('18 Apr 2026');
  });
});
