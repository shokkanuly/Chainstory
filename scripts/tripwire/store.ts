// Operator-only SQLite state (ADR-015). Never imported by the browser or proxies.
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { burnEventSchema, releaseEventSchema, eventOriginSchema } from './events.js';
import { blockHashSchema, feedCheckpointSchema, finalizedCheckpointSchema } from './finality.js';
import { proofPosition, sourceProofSchema, sourceVerifierScopeSchema, type SourceProof } from './sourceProof.js';
import { discoveryStateSchema, type DiscoveryState } from './discoveryState.js';

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
const rawTransaction = z.string().regex(/^0x([0-9a-fA-F]{2})+$/);
/** Fee bumps one journaled nonce may take before a human looks at it. */
export const MAX_REPLACEMENTS = 8;
export const transactionStateSchema = z.object({
  id: z.string().min(1).max(512), request: transactionRequestSchema,
  raw: rawTransaction, hash,
  /** Same nonce and call re-signed with higher fees, oldest first. Append-only; journaled before broadcast. */
  replacements: z.array(z.object({ raw: rawTransaction, hash }).strict()).max(MAX_REPLACEMENTS).optional(),
  /** The replacement the receipt belongs to; absent when it is the original. */
  minedHash: hash.optional(),
  status: z.enum(['signed', 'included', 'confirmed', 'reverted']),
  block: decimal.optional(), gas: decimal.optional(),
  blockHash: blockHashSchema.optional(), receiptStatus: z.enum(['success', 'reverted']).optional(),
  orphanedReceipts: z.array(z.object({ block: decimal, blockHash: blockHashSchema, receiptStatus: z.enum(['success', 'reverted']),
    minedHash: hash.optional() }).strict()).optional(),
}).strict().refine((v) => v.status === 'signed'
  ? v.block === undefined && v.gas === undefined && v.blockHash === undefined && v.receiptStatus === undefined && v.minedHash === undefined
  : v.block !== undefined && v.gas !== undefined && (v.status !== 'included' || (v.blockHash !== undefined && v.receiptStatus !== undefined)),
  'Terminal transaction state requires its receipt.')
  .refine((v) => {
    const hashes = [v.hash, ...(v.replacements ?? []).map((r) => r.hash)];
    return new Set(hashes).size === hashes.length && (v.minedHash === undefined || hashes.slice(1).includes(v.minedHash));
  }, 'Transaction versions must be distinct, and a receipt must belong to one of them.');
export type TransactionState = z.infer<typeof transactionStateSchema>;
const outcomeSchema = z.object({ messageId: blockHashSchema, action: z.enum(['executed', 'rejected', 'returned']), recipient: address, amount }).strict();
export type ReleaseOutcome = z.output<typeof outcomeSchema>;
// Screening evidence journal (ADR-048): the provider's original signed envelopes,
// what they were checked against, the result, and retained contradictions.
// Append-only; a record is written before anything it led to is signed.
const word = z.string().regex(/^0x[0-9a-f]{64}$/);
const screeningScope = { messageId: blockHashSchema, profileHash: word, headHash: word, contextHash: word };
/** Original provider envelopes, kept exactly as received (bounded). */
const rawEvidence = z.union([z.object({ status: z.enum(['missing', 'provider-unavailable']) }).strict(),
  z.object({ status: z.literal('available'), head: z.unknown(), receipts: z.array(z.unknown()).max(64) }).strict()]);
export const screeningRecordSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('evidence'), ...screeningScope, block: z.object({ number: decimal, hash: blockHashSchema }).strict(), now: decimal,
    evidence: rawEvidence }).strict(),
  z.object({ kind: z.literal('result'), ...screeningScope, now: decimal, status: z.enum(['verified', 'unavailable']),
    outcome: z.enum(['UNKNOWN', 'NOT_LISTED', 'MATCHED']).optional(), reason: z.string().min(1).max(64).optional(),
    receiptHash: word.optional() }).strict(),
  z.object({ kind: z.literal('incident'), ...screeningScope, now: decimal, reason: z.literal('contradictory'),
    outcomes: z.array(z.enum(['UNKNOWN', 'NOT_LISTED', 'MATCHED'])).max(3) }).strict(),
]);
export type ScreeningRecord = z.output<typeof screeningRecordSchema>;
const MAX_SCREENING_RECORD = 64 * 1024;
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
          settlement_key TEXT UNIQUE NOT NULL, nonce TEXT UNIQUE NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS release_outcomes (id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS screening_journal (seq INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL,
          kind TEXT NOT NULL, value TEXT NOT NULL);`);
      const expected = encode({ version: 3, scope: this.scope });
      const metadata = this.db.prepare('SELECT value FROM state WHERE key=?').get('metadata');
      if (!metadata && (this.db.prepare('SELECT key FROM state LIMIT 1').get() || this.db.prepare('SELECT id FROM transactions LIMIT 1').get() || this.db.prepare('SELECT id FROM source_proofs LIMIT 1').get() || this.db.prepare('SELECT id FROM release_outcomes LIMIT 1').get() || this.db.prepare('SELECT seq FROM screening_journal LIMIT 1').get())) {
        throw new Error('Operator state metadata is missing. Refusing to assume its deployment scope.');
      }
      if (metadata && metadata.value !== expected) throw new Error('Operator state schema version or deployment scope does not match.');
      this.db.prepare('INSERT OR IGNORE INTO state VALUES (?, ?)').run('metadata', expected);
      // Validate persisted input before any caller may poll or sign.
      this.loadWatcher(); this.transactions(); this.sourceProofs(); this.sourceQuarantine(); this.outcomes(); this.loadDiscovery(); this.screeningRecords();
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

  loadDiscovery(): DiscoveryState | null {
    const row = this.db.prepare('SELECT value FROM state WHERE key=?').get('discovery');
    if (!row) return null;
    const state = discoveryStateSchema.parse(JSON.parse(String(row.value)));
    this.checkDiscoveryScope(state); return state;
  }

  /** BOTH feed cursors and all hints commit in one SQLite row under the lease. */
  saveDiscovery(input: DiscoveryState): void {
    if (this.sourceQuarantine() || this.loadWatcher()?.quarantine) throw new Error('Discovery journal is quarantined; reconcile before advancing.');
    const state = discoveryStateSchema.parse(input); this.checkDiscoveryScope(state);
    const previous = this.loadDiscovery();
    if (previous) {
      if (state.fingerprint !== previous.fingerprint) throw new Error('Discovery manifest scope cannot change.');
      for (const side of ['source', 'destination'] as const) {
        const old = previous[side], next = state[side];
        if (old.from !== next.from || next.through.number < old.through.number ||
          (old.through.number === next.through.number && encode(old) !== encode(next))) throw new Error('Discovery cursor cannot reset or replace its anchor.');
      }
      for (const key of ['burns', 'credits'] as const) {
        if (state[key].length < previous[key].length || encode(state[key].slice(0, previous[key].length)) !== encode(previous[key])) throw new Error('Discovery hints cannot be replaced or dropped.');
        const side = key === 'burns' ? 'source' : 'destination';
        if (state[key].slice(previous[key].length).some((h) => h.origin.blockNumber <= previous[side].through.number)) throw new Error('Discovery cannot insert a hint behind its committed cursor.');
      }
    }
    this.db.prepare('INSERT INTO state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('discovery', encode(state));
  }

  private checkDiscoveryScope(state: DiscoveryState): void {
    if (this.scope.finalityMode !== 'finalized' || this.scope.sourceVerifier?.profile !== 'customer-payment-v1') throw new Error('Discovery requires a finalized customer-payment journal.');
    for (const [range, chainId, address, event] of [[state.source, this.scope.sourceChainId, this.scope.source, 'MessageSent'],
      [state.destination, this.scope.chainId, this.scope.vault, 'PaymentCreditBound']] as const) {
      const c = finalizedCheckpointSchema.parse(JSON.parse(range.checkpoint));
      if (c.chainId !== chainId || c.address !== address || c.event !== event) throw new Error('Discovery checkpoint deployment scope does not match.');
    }
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
      proofPosition(p.destination) === proofPosition(proof.destination) ||
      (proof.payment && p.payment?.operationId === proof.payment.operationId))) return 'reused';
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
    if ((this.scope.sourceVerifier.profile === 'customer-payment-v1') !== Boolean(proof.payment)) throw new Error('Source proof customer intent profile does not match.');
  }

  outcomes(): ReleaseOutcome[] {
    return this.db.prepare('SELECT * FROM release_outcomes ORDER BY rowid').all().map((row) => {
      const outcome = outcomeSchema.parse(JSON.parse(String(row.value)));
      if (row.id !== outcome.messageId) throw new Error('Release outcome journal identity is corrupt.');
      return outcome;
    });
  }

  /** Caller must confirm terminal state at a hash-checked finalized block first. */
  saveOutcome(input: ReleaseOutcome): void {
    const outcome = outcomeSchema.parse(input), previous = this.outcomes().find((o) => o.messageId === outcome.messageId);
    if (previous && encode(previous) !== encode(outcome)) throw new Error('Cannot replace a terminal release outcome.');
    this.db.prepare('INSERT OR IGNORE INTO release_outcomes VALUES (?, ?)').run(outcome.messageId, encode(outcome));
  }

  screeningRecords(messageId?: string): ScreeningRecord[] {
    const rows = messageId === undefined ? this.db.prepare('SELECT * FROM screening_journal ORDER BY seq').all()
      : this.db.prepare('SELECT * FROM screening_journal WHERE message_id=? ORDER BY seq').all(messageId);
    return rows.map((row) => {
      const record = screeningRecordSchema.parse(JSON.parse(String(row.value)));
      if (row.message_id !== record.messageId || row.kind !== record.kind) throw new Error('Screening journal identity is corrupt.');
      return record;
    });
  }

  /** Append only. Callers write evidence before relaying or signing anything that depends on it. */
  saveScreeningRecord(input: ScreeningRecord): void {
    const record = screeningRecordSchema.parse(input), value = encode(record);
    if (value.length > MAX_SCREENING_RECORD) throw new Error('Screening record is too large to journal.');
    this.db.prepare('INSERT INTO screening_journal (message_id, kind, value) VALUES (?, ?, ?)').run(record.messageId, record.kind, value);
  }

  private checkOrigins(state: WatcherState): void {
    if (this.scope.finalityMode !== 'finalized') return;
    for (const [events, chainId, address, cursor] of [[state.burns, this.scope.sourceChainId, this.scope.source, state.ingressCursor],
      [state.pending, this.scope.chainId, this.scope.vault, state.egressCursor], [state.history, this.scope.chainId, this.scope.vault, state.egressCursor]] as const) {
      const checkpoint = finalizedCheckpointSchema.parse(JSON.parse(cursor));
      if (checkpoint.chainId !== chainId || checkpoint.address !== address) throw new Error('Finalized checkpoint deployment scope does not match.');
      // A payout's backing must be final; only release requests may be read at the safe head.
      if (events === state.burns && checkpoint.policy !== 'finalized') throw new Error('Source events must come from finalized blocks.');
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
    const before = previous?.replacements ?? [], after = checked.replacements ?? [];
    if (before.length > after.length || before.some((r, i) => r.raw !== after[i].raw || r.hash !== after[i].hash)) {
      throw new Error('Journaled replacements are append-only.');
    }
    if (after.length > before.length && (previous?.status !== 'signed' || checked.status !== 'signed')) {
      throw new Error('Only a journaled transaction with no known inclusion can be replaced.');
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
      minedHash: undefined, orphanedReceipts: [...(previous.orphanedReceipts ?? []), { block: previous.block, blockHash: previous.blockHash,
        receiptStatus: previous.receiptStatus, minedHash: previous.minedHash }] });
    this.db.prepare('UPDATE transactions SET value=? WHERE id=?').run(encode(state), id);
    return state;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.db.close(); } finally { this.lease.close(); }
  }
}
