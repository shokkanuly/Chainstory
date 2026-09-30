// Operator-only SQLite state (ADR-015). Never imported by the browser or proxies.
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { burnEventSchema, releaseEventSchema } from './events.js';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase());
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const amount = z.union([z.bigint(), decimal.transform(BigInt)]).pipe(z.bigint().positive());
const scopeSchema = z.object({
  route: z.string().min(1), chainId: z.number().int().positive(), sourceChainId: z.number().int().positive(),
  source: address, vault: address, guardian: address, token: address, sender: address,
  decimals: z.number().int().min(0).max(36),
}).strict();
export type OperatorScope = z.input<typeof scopeSchema>;
export const watcherStateSchema = z.object({
  ingressCursor: decimal, egressCursor: decimal,
  burns: z.array(burnEventSchema.extend({ amount })),
  pending: z.array(releaseEventSchema.extend({ amount })),
  completed: z.array(hash), conflictingBurns: z.array(hash), conflictingReleases: z.array(hash),
  history: z.array(releaseEventSchema.extend({ amount })),
}).strict();
export type WatcherState = z.output<typeof watcherStateSchema>;
export const transactionRequestSchema = z.object({
  to: address, data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/), value: decimal,
}).strict();
export type TransactionRequest = z.infer<typeof transactionRequestSchema>;
export const transactionStateSchema = z.object({
  id: z.string().min(1).max(512), request: transactionRequestSchema,
  raw: z.string().regex(/^0x([0-9a-fA-F]{2})+$/), hash,
  status: z.enum(['signed', 'confirmed', 'reverted']),
  block: decimal.optional(), gas: decimal.optional(),
}).strict().refine((v) => v.status === 'signed' ? v.block === undefined && v.gas === undefined : v.block !== undefined && v.gas !== undefined,
  'Terminal transaction state requires its receipt.');
export type TransactionState = z.infer<typeof transactionStateSchema>;
const encode = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v);

export class OperatorStore {
  private db: DatabaseSync;
  private lease: DatabaseSync;
  private closed = false;
  readonly scope: z.output<typeof scopeSchema>;

  constructor(path: string, scope: OperatorScope) {
    this.scope = scopeSchema.parse(scope);
    const file = resolve(path);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    // A separate SQLite EXCLUSIVE transaction is a process lease. The OS
    // releases it on a crash, unlike a stale PID/mkdir lock. Never unlink it.
    this.lease = new DatabaseSync(`${file}.lease`);
    chmodSync(`${file}.lease`, 0o600);
    try { this.lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE'); }
    catch (error) {
      this.lease.close();
      if (error instanceof Error && error.message.includes('locked')) throw new Error('An operator is already running for this state file.');
      throw error;
    }
    try { this.db = new DatabaseSync(file); }
    catch (error) { this.lease.close(); throw error; }
    try {
      chmodSync(file, 0o600);
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      const expected = encode({ version: 1, scope: this.scope });
      const metadata = this.db.prepare('SELECT value FROM state WHERE key=?').get('metadata');
      if (!metadata && (this.db.prepare('SELECT key FROM state LIMIT 1').get() || this.db.prepare('SELECT id FROM transactions LIMIT 1').get())) {
        throw new Error('Operator state metadata is missing. Refusing to assume its deployment scope.');
      }
      if (metadata && metadata.value !== expected) throw new Error('Operator state schema version or deployment scope does not match.');
      this.db.prepare('INSERT OR IGNORE INTO state VALUES (?, ?)').run('metadata', expected);
      // Validate persisted input before any caller may poll or sign.
      this.loadWatcher(); this.transactions();
    } catch (error) { this.close(); throw error; }
  }

  loadWatcher(): WatcherState | null {
    const row = this.db.prepare('SELECT value FROM state WHERE key=?').get('watcher');
    return row ? watcherStateSchema.parse(JSON.parse(String(row.value))) : null;
  }

  saveWatcher(state: WatcherState): void {
    const checked = watcherStateSchema.parse(state);
    // One atomic row contains BOTH cursors, events, pending jobs and history.
    this.db.prepare('INSERT INTO state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('watcher', encode(checked));
  }

  transaction(id: string): TransactionState | null {
    const row = this.db.prepare('SELECT value FROM transactions WHERE id=?').get(id);
    return row ? transactionStateSchema.parse(JSON.parse(String(row.value))) : null;
  }

  transactions(): TransactionState[] {
    return this.db.prepare('SELECT value FROM transactions ORDER BY rowid').all()
      .map((row) => transactionStateSchema.parse(JSON.parse(String(row.value))));
  }

  saveTransaction(state: TransactionState): void {
    const checked = transactionStateSchema.parse(state);
    const previous = this.transaction(checked.id);
    if (previous && (previous.raw !== checked.raw || previous.hash !== checked.hash || encode(previous.request) !== encode(checked.request))) {
      throw new Error('Cannot replace a journaled transaction.');
    }
    if (previous && previous.status !== 'signed' && encode(previous) !== encode(checked)) throw new Error('Cannot change a terminal receipt.');
    this.db.prepare('INSERT INTO transactions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(checked.id, encode(checked));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.db.close(); } finally { this.lease.close(); }
  }
}
