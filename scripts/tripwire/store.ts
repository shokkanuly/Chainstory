// Operator-only SQLite state (ADR-015). Never imported by the browser or proxies.
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { burnEventSchema, releaseEventSchema, eventOriginSchema } from './events.js';
import { blockHashSchema, feedCheckpointSchema, finalizedCheckpointSchema } from './finality.js';
import { proofPosition, sourceProofSchema, sourceVerifierScopeSchema, type SourceProof } from './sourceProof.js';

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase());
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const amount = z.union([z.bigint(), decimal.transform(BigInt)]).pipe(z.bigint().positive());
const storedOrigin = eventOriginSchema.extend({ blockNumber: z.union([z.bigint(), decimal.transform(BigInt)]).pipe(z.bigint().nonnegative()) }).optional();
const scopeSchema = z.object({
  route: z.string().min(1), chainId: z.number().int().positive(), sourceChainId: z.number().int().positive(),
  source: address, vault: address, guardian: address, token: address, sender: address,
  decimals: z.number().int().min(0).max(36),
  finalityMode: z.enum(['local', 'finalized']).default('local'),
  sourceVerifier: sourceVerifierScopeSchema.optional(),
}).strict();
export type OperatorScope = z.input<typeof scopeSchema>;
export const watcherStateSchema = z.object({
  ingressCursor: feedCheckpointSchema, egressCursor: feedCheckpointSchema,
  burns: z.array(burnEventSchema.extend({ amount, origin: storedOrigin })),
  pending: z.array(releaseEventSchema.extend({ amount, origin: storedOrigin })),
  completed: z.array(hash), conflictingBurns: z.array(hash), conflictingReleases: z.array(hash),
  history: z.array(releaseEventSchema.extend({ amount, origin: storedOrigin })),
  quarantine: z.string().min(1).max(2048).optional(),
}).strict();
export type WatcherState = z.output<typeof watcherStateSchema>;
export const transactionRequestSchema = z.object({
  to: address, data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/), value: decimal,
}).strict();
export type TransactionRequest = z.infer<typeof transactionRequestSchema>;
export const transactionStateSchema = z.object({
  id: z.string().min(1).max(512), request: transactionRequestSchema,
  raw: z.string().regex(/^0x([0-9a-fA-F]{2})+$/), hash,
  status: z.enum(['signed', 'included', 'confirmed', 'reverted']),
  block: decimal.optional(), gas: decimal.optional(),
  blockHash: blockHashSchema.optional(), receiptStatus: z.enum(['success', 'reverted']).optional(),
  orphanedReceipts: z.array(z.object({ block: decimal, blockHash: blockHashSchema, receiptStatus: z.enum(['success', 'reverted']) })).optional(),
}).strict().refine((v) => v.status === 'signed'
  ? v.block === undefined && v.gas === undefined && v.blockHash === undefined && v.receiptStatus === undefined
  : v.block !== undefined && v.gas !== undefined && (v.status !== 'included' || (v.blockHash !== undefined && v.receiptStatus !== undefined)),
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
        CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS source_proofs (id TEXT PRIMARY KEY, source_key TEXT UNIQUE NOT NULL,
          settlement_key TEXT UNIQUE NOT NULL, nonce TEXT UNIQUE NOT NULL, value TEXT NOT NULL);`);
      const expected = encode({ version: 3, scope: this.scope });
      const metadata = this.db.prepare('SELECT value FROM state WHERE key=?').get('metadata');
      if (!metadata && (this.db.prepare('SELECT key FROM state LIMIT 1').get() || this.db.prepare('SELECT id FROM transactions LIMIT 1').get() || this.db.prepare('SELECT id FROM source_proofs LIMIT 1').get())) {
        throw new Error('Operator state metadata is missing. Refusing to assume its deployment scope.');
      }
      if (metadata && metadata.value !== expected) throw new Error('Operator state schema version or deployment scope does not match.');
      this.db.prepare('INSERT OR IGNORE INTO state VALUES (?, ?)').run('metadata', expected);
      // Validate persisted input before any caller may poll or sign.
      this.loadWatcher(); this.transactions(); this.sourceProofs(); this.sourceQuarantine();
    } catch (error) { this.close(); throw error; }
  }

  loadWatcher(): WatcherState | null {
    const row = this.db.prepare('SELECT value FROM state WHERE key=?').get('watcher');
    if (!row) return null;
    const state = watcherStateSchema.parse(JSON.parse(String(row.value))); this.checkOrigins(state); return state;
  }

  saveWatcher(state: WatcherState): void {
    const checked = watcherStateSchema.parse(state);
    this.checkOrigins(checked);
    // One atomic row contains BOTH cursors, events, pending jobs and history.
    this.db.prepare('INSERT INTO state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('watcher', encode(checked));
  }

  sourceProofs(): SourceProof[] {
    return this.db.prepare('SELECT * FROM source_proofs ORDER BY rowid').all().map((row) => {
      const proof = sourceProofSchema.parse(JSON.parse(String(row.value)));
      this.checkProofScope(proof);
      if (row.id !== proof.messageId || row.source_key !== proofPosition(proof.source) ||
        row.settlement_key !== proofPosition(proof.destination) || row.nonce !== proof.nonce) {
        throw new Error('Source proof journal identity is corrupt.');
      }
      return proof;
    });
  }

  sourceQuarantine(): string | null {
    const row = this.db.prepare('SELECT value FROM state WHERE key=?').get('source_quarantine');
    return row ? z.string().min(1).max(2048).parse(JSON.parse(String(row.value))) : null;
  }

  /** A proof audit may discover a conflict before a watcher snapshot exists. */
  quarantineSource(reason: string): void {
    if (!this.scope.sourceVerifier) throw new Error('Source quarantine requires its scoped adapter.');
    const checked = z.string().min(1).max(2048).parse(reason);
    this.db.prepare('INSERT OR IGNORE INTO state VALUES (?, ?)').run('source_quarantine', encode(checked));
  }

  /** Claim source event, settlement event and bridge nonce atomically before ALLOW. */
  saveSourceProof(input: SourceProof): 'saved' | 'reused' {
    const proof = sourceProofSchema.parse(input); this.checkProofScope(proof);
    const prior = this.sourceProofs();
    const same = prior.find((p) => p.messageId === proof.messageId);
    if (same) {
      if (encode(same) !== encode(proof)) throw new Error('Cannot replace authenticated source proof.');
      return 'saved'; // Idempotent recheck; never a second credit.
    }
    if (prior.some((p) => p.nonce === proof.nonce || proofPosition(p.source) === proofPosition(proof.source) ||
      proofPosition(p.destination) === proofPosition(proof.destination))) return 'reused';
    this.db.prepare('INSERT INTO source_proofs VALUES (?, ?, ?, ?, ?)')
      .run(proof.messageId, proofPosition(proof.source), proofPosition(proof.destination), proof.nonce, encode(proof));
    return 'saved';
  }

  private checkProofScope(proof: SourceProof): void {
    if (this.scope.finalityMode !== 'finalized' || !this.scope.sourceVerifier ||
      proof.source.chainId !== this.scope.sourceChainId || proof.source.address !== this.scope.source ||
      proof.destination.chainId !== this.scope.chainId || proof.destination.address !== this.scope.sourceVerifier.settlement) {
      throw new Error('Source proof deployment scope does not match.');
    }
  }

  private checkOrigins(state: WatcherState): void {
    if (this.scope.finalityMode !== 'finalized') return;
    for (const [events, chainId, address, cursor] of [[state.burns, this.scope.sourceChainId, this.scope.source, state.ingressCursor],
      [state.pending, this.scope.chainId, this.scope.vault, state.egressCursor], [state.history, this.scope.chainId, this.scope.vault, state.egressCursor]] as const) {
      const checkpoint = finalizedCheckpointSchema.parse(JSON.parse(cursor));
      if (checkpoint.chainId !== chainId || checkpoint.address !== address) throw new Error('Finalized checkpoint deployment scope does not match.');
      for (const event of events) {
        if (!event.origin || event.origin.chainId !== chainId || event.origin.address !== address ||
          event.origin.blockNumber < BigInt(checkpoint.from) || event.origin.blockNumber >= BigInt(checkpoint.next)) {
          throw new Error('Finalized state requires event provenance for the configured chain and contract.');
        }
      }
    }
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
    if (previous && (previous.status === 'confirmed' || previous.status === 'reverted') && encode(previous) !== encode(checked)) throw new Error('Cannot change a terminal receipt.');
    if (previous?.status === 'included' && checked.status === 'signed') throw new Error('Use explicit reorg reconciliation to reopen an included transaction.');
    this.db.prepare('INSERT INTO transactions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(checked.id, encode(checked));
  }

  /** Only unfinalized inclusion may be reopened, retaining an audit trail. */
  reopenTransaction(id: string): TransactionState {
    const previous = this.transaction(id);
    if (previous?.status !== 'included' || !previous.block || !previous.blockHash || !previous.receiptStatus) {
      throw new Error('Only an unfinalized included transaction can be reopened.');
    }
    const state = transactionStateSchema.parse({ ...previous, status: 'signed', block: undefined, gas: undefined, blockHash: undefined, receiptStatus: undefined,
      orphanedReceipts: [...(previous.orphanedReceipts ?? []), { block: previous.block, blockHash: previous.blockHash, receiptStatus: previous.receiptStatus }] });
    this.db.prepare('UPDATE transactions SET value=? WHERE id=?').run(encode(state), id);
    return state;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.db.close(); } finally { this.lease.close(); }
  }
}
