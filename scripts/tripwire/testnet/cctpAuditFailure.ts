// Typed lifecycle failures. Raw causes stay internal; process diagnostics use fixed text only.
import { HttpRequestError, TimeoutError, LimitExceededRpcError } from 'viem';
import { FinalityConflictError } from '../finality.js';

export type AuditFailureReason = 'configuration' | 'deployment' | 'journal' | 'quarantine' | 'rpc-unavailable' | 'internal';
export class CctpAuditFailure extends Error {
  constructor(readonly reason: AuditFailureReason, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'CCTP audit failed.', { cause });
    this.name = 'CctpAuditFailure';
  }
}
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
    if (error instanceof CctpAuditFailure || error instanceof FinalityConflictError) throw error;
    throw new CctpAuditFailure(rpc && isTransientAuditRpcError(error) ? 'rpc-unavailable' : fallback, error);
  }
}
