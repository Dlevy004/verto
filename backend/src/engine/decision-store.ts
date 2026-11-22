import { Pool } from 'pg';

export interface StoredDecision {
  id: string;
  request_id: string;
  verdict: string;
  reason_codes: string[];
  signals: unknown;
  decided_by: string;
  is_override: boolean;
  created_at: Date;
}

export interface NewDecision {
  requestId: string;
  verdict: string;
  reasonCodes: string[];
  signals: unknown;
  decidedBy: string; // 'ENGINE' or a user id
  isOverride?: boolean;
}

// Shared by the pool-based and the transaction-based callers.
export const INSERT_DECISION_SQL = `
  INSERT INTO decision (request_id, verdict, reason_codes, signals, decided_by, is_override)
  VALUES ($1, $2::verdict_status, $3::text[], $4::jsonb, $5, $6)
  RETURNING id, created_at`;

export const decisionParams = (d: NewDecision): unknown[] => [
  d.requestId,
  d.verdict,
  d.reasonCodes,
  JSON.stringify(d.signals),
  d.decidedBy,
  d.isOverride ?? false,
];

export async function saveDecision(
  pool: Pool,
  decision: NewDecision,
): Promise<{ id: string; created_at: Date }> {
  const r = await pool.query<{ id: string; created_at: Date }>(
    INSERT_DECISION_SQL,
    decisionParams(decision),
  );
  return r.rows[0];
}

/** The decision table is append-only: the newest row is the valid one. */
export async function loadLatestDecision(
  pool: Pool,
  requestId: string,
): Promise<StoredDecision | null> {
  const r = await pool.query<StoredDecision>(
    `SELECT id, request_id, verdict::text AS verdict, reason_codes, signals,
            decided_by, is_override, created_at
     FROM decision
     WHERE request_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [requestId],
  );
  return r.rows[0] ?? null;
}