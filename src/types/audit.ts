/**
 * One record from `get_audit_events` — mirrors the backend `AuditLogEntry`
 * (camelCase). `legacy` rows carry the pre-JSONL line verbatim in `raw`.
 */
export interface AuditLogEntry {
  ts?: string;
  actor?: string;
  actorId?: string;
  actorName?: string;
  action?: string;
  target?: string;
  result?: string;
  detail?: string;
  meta?: Record<string, unknown>;
  legacy: boolean;
  raw?: string;
}
