// Compatibility entrypoint; the single implementation is shared with source authentication.
export { CctpAuditFailure, RpcBehindError, auditBoundary, journalOperation, isTransientAuditRpcError,
  retryableAuditFailure, type AuditFailureReason } from '../auditFailure.js';
