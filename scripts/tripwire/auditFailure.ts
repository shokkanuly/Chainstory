// Shared operator/observer failure types. Raw causes are internal, never public diagnostics.
import { HttpRequestError, TimeoutError, LimitExceededRpcError } from 'viem';
import { FinalityConflictError } from './finality.js';

export type AuditFailureReason = 'configuration' | 'deployment' | 'journal' | 'quarantine' | 'rpc-unavailable' | 'rpc-behind' | 'scope' | 'capacity' | 'evidence' | 'internal';
export class CctpAuditFailure extends Error {
  constructor(readonly reason: AuditFailureReason, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'CCTP audit failed.', { cause });
    this.name = 'CctpAuditFailure';
  }
}
export class RpcBehindError extends CctpAuditFailure {
  constructor(message: string) { super('rpc-behind', new Error(message)); this.name = 'RpcBehindError'; }
}
export class ObservationCanceledError extends Error {}
export const retryableAuditFailure = (reason: AuditFailureReason) => reason === 'rpc-unavailable' || reason === 'rpc-behind';
export function isTransientAuditRpcError(error: unknown): boolean {
  const seen = new Set<unknown>(); let transient = false;
  for (let depth = 0; error instanceof Error; depth++) {
    if (depth >= 12 || seen.has(error)) return false;
    seen.add(error);
    if (error instanceof HttpRequestError) {
      const status = error.status;
      if (status !== undefined && (!Number.isInteger(status) || (status !== 408 && status !== 429 && (status < 500 || status > 599)))) return false;
      transient = true;
    }
    if (error instanceof TimeoutError || error instanceof LimitExceededRpcError) transient = true;
    error = error.cause;
  }
  return transient;
}
export async function auditBoundary<T>(fallback: AuditFailureReason, run: () => T | Promise<T>, rpc = false): Promise<T> {
  try { return await run(); }
  catch (error) {
    if (error instanceof CctpAuditFailure || error instanceof FinalityConflictError || error instanceof ObservationCanceledError) throw error;
    throw new CctpAuditFailure(rpc && isTransientAuditRpcError(error) ? 'rpc-unavailable' : fallback, error);
  }
}
export function journalOperation<T>(run: () => T): T {
  try { return run(); }
  catch (error) {
    // A local journal boundary outranks even a transport-shaped cause. Never retry it as RPC.
    throw new CctpAuditFailure('journal', error);
  }
}
