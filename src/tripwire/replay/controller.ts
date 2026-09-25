// src/tripwire/replay/controller.ts
//
// Drives a replay over time: start, pause, step, setSpeed, select, reset.
// UI-agnostic — React subscribes through useSyncExternalStore, so the snapshot
// is an immutable object replaced on every change.

import { IncidentReplay, type ReplaySnapshot } from './engine.js';
import { INCIDENTS, type Incident } from './incidents.js';

export type ControllerStatus = 'loading' | 'ready' | 'playing' | 'done' | 'error';

export interface ControllerState {
  status: ControllerStatus;
  incidentId: Incident['id'];
  replay: ReplaySnapshot | null;
  /** Delay between events while playing. */
  speedMs: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ReplayController {
  private state: ControllerState;
  private listeners = new Set<() => void>();
  private replay: IncidentReplay | null = null;
  /** Bumped on every load, so a stale load or loop cannot write into a newer replay. */
  private generation = 0;
  /** Steps are async EVM calls; this serialises them so a click cannot interleave with playback. */
  private queue: Promise<void> = Promise.resolve();

  constructor(incidentId: Incident['id'] = INCIDENTS[0].id, speedMs = 700) {
    this.state = { status: 'loading', incidentId, replay: null, speedMs };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<ControllerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  async select(incidentId: Incident['id']) {
    const generation = ++this.generation;
    this.replay = null;
    this.set({ status: 'loading', incidentId, replay: null, error: undefined });
    const incident = INCIDENTS.find((i) => i.id === incidentId);
    if (!incident) return this.set({ status: 'error', error: `Unknown incident ${incidentId}` });
    try {
      const replay = await IncidentReplay.create(incident);
      if (generation !== this.generation) return;
      this.replay = replay;
      this.set({ status: 'ready', replay: replay.snapshot() });
    } catch (err) {
      if (generation === this.generation) this.fail(err);
    }
  }

  reset() {
    return this.select(this.state.incidentId);
  }

  step(): Promise<void> {
    const generation = this.generation;
    this.queue = this.queue.then(() => this.advance(generation));
    return this.queue;
  }

  start() {
    if (this.state.status !== 'ready') return;
    const generation = this.generation;
    this.set({ status: 'playing' });
    void (async () => {
      while (this.state.status === 'playing' && generation === this.generation) {
        await this.step();
        if (this.state.status !== 'playing' || generation !== this.generation) break;
        await sleep(this.state.speedMs);
      }
    })();
  }

  /** Stop any playback and ignore in-flight work — for when the page unmounts. */
  dispose() {
    this.generation += 1;
    if (this.state.status === 'playing') this.set({ status: 'ready' });
  }

  pause() {
    if (this.state.status === 'playing') this.set({ status: 'ready' });
  }

  setSpeed(speedMs: number) {
    this.set({ speedMs: Math.max(50, speedMs) });
  }

  private async advance(generation: number) {
    const replay = this.replay;
    if (!replay || generation !== this.generation || this.state.status === 'done') return;
    try {
      await replay.step();
      if (generation !== this.generation) return;
      const snapshot = replay.snapshot();
      this.set({
        replay: snapshot,
        status: snapshot.done ? 'done' : this.state.status === 'playing' ? 'playing' : 'ready',
      });
    } catch (err) {
      if (generation === this.generation) this.fail(err);
    }
  }

  private fail(err: unknown) {
    this.set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
