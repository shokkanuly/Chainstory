import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import { actors } from '../../../src/tripwire/guardianVM.js';
import { OperatorStore, watcherStateSchema, type WatcherState } from '../store.js';

const scope = { route: 'crash', chainId: 31337, sourceChainId: 31337, source: actors.owner.address,
  vault: actors.bridge.address, guardian: actors.oracle.address, token: actors.relayer.address, sender: actors.owner.address, decimals: 6 };
const messageId = keccak256(toHex('crash'));
const state: WatcherState = { ingressCursor: '100', egressCursor: '101', burns: [], completed: [], conflictingBurns: [], conflictingReleases: [], history: [],
  pending: [{ messageId, recipient: actors.bridge.address, amount: 10n ** 30n + 1n, timestamp: 1_780_000_000 }] };
const snapshot = JSON.stringify(state, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value);

describe('operator process death', () => {
  it('refuses a legacy v1 database without resetting or discarding its pending work', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tripwire-legacy-')); const path = join(dir, 'state.sqlite');
    try {
      const store = new OperatorStore(path, scope); store.saveWatcher(state); store.close();
      const db = new DatabaseSync(path); const row = db.prepare('SELECT value FROM state WHERE key=?').get('metadata');
      const metadata = JSON.parse(String(row?.value)); metadata.version = 1;
      db.prepare('UPDATE state SET value=? WHERE key=?').run(JSON.stringify(metadata), 'metadata'); db.close();
      expect(() => new OperatorStore(path, scope)).toThrow('schema version');
      const preserved = new DatabaseSync(path);
      try { expect(JSON.parse(String(preserved.prepare('SELECT value FROM state WHERE key=?').get('watcher')?.value)).pending).toHaveLength(1); }
      finally { preserved.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  for (const commit of [false, true]) it(`recovers ${commit ? 'committed' : 'uncommitted'} cursor + queue atomically after SIGKILL and releases the lease`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tripwire-kill-')); const path = join(dir, 'state.sqlite');
    const initial = new OperatorStore(path, scope); initial.close();
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const [path, snapshot, commit] = process.argv.slice(1);
      const lease = new DatabaseSync(path + '.lease'); lease.exec('BEGIN EXCLUSIVE');
      const db = new DatabaseSync(path); db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
      db.prepare('INSERT INTO state VALUES (?, ?)').run('watcher', snapshot);
      if (commit === 'true') db.exec('COMMIT');
      process.stdout.write('ready'); setInterval(() => {}, 1000);
    `, path, snapshot, String(commit)], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const ready = once(child.stdout, 'data');
      await Promise.race([ready, once(child, 'exit').then(() => { throw new Error('Crash fixture exited before writing.'); })]);
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
      const restored = new OperatorStore(path, scope);
      try { expect(restored.loadWatcher()).toEqual(commit ? watcherStateSchema.parse(state) : null); }
      finally { restored.close(); }
    } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(['version', 'cursor', 'amount', 'missing metadata'])('fails closed on corrupted %s instead of resetting the queue', (corruption) => {
    const dir = mkdtempSync(join(tmpdir(), 'tripwire-corrupt-')); const path = join(dir, 'state.sqlite');
    try {
      const store = new OperatorStore(path, scope); store.saveWatcher(state); store.close();
      const db = new DatabaseSync(path);
      if (corruption === 'version') db.prepare('UPDATE state SET value=? WHERE key=?').run('{}', 'metadata');
      else if (corruption === 'missing metadata') db.prepare('DELETE FROM state WHERE key=?').run('metadata');
      else {
        const changed = JSON.parse(snapshot);
        if (corruption === 'cursor') changed.egressCursor = '-1'; else changed.pending[0].amount = '1.01';
        db.prepare('UPDATE state SET value=? WHERE key=?').run(JSON.stringify(changed), 'watcher');
      }
      db.close(); expect(() => new OperatorStore(path, scope)).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
