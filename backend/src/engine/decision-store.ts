import { Pool } from 'pg';

export interface StoredDecision {
  id: string;
  request_id: string;
  revision: number;
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

export interface SavedDecision {
  id: string;
  revision: number;
  created_at: Date;
}

// The next revision is computed in the same statement. It is only race-free while the
// caller holds the request row lock (FOR UPDATE); UNIQUE (request_id, revision) is the safety net.
export const INSERT_DECISION_SQL = `
  INSERT INTO decision
    (request_id, revision, verdict, reason_codes, signals, decided_by, is_override)
  VALUES (
    $1,
    (SELECT COALESCE(MAX(revision), 0) + 1 FROM decision WHERE request_id = $1),
    $2::verdict_status, $3::text[], $4::jsonb, $5, $6
  )
  RETURNING id, revision, created_at`;

export const decisionParams = (d: NewDecision): unknown[] => [
  d.requestId,
  d.verdict,
  d.reasonCodes,
  JSON.stringify(d.signals),
  d.decidedBy,
  d.isOverride ?? false,
];

/**
 * Inserts a decision under the request row lock (the same lock the approval transaction takes),
 * so all decisions of one request are serialized.
 * With expectedRevision set, the write is fenced: it only happens when that revision is still
 * the latest one, otherwise the evaluation is stale and null is returned.
 */
async function insertDecision(
  pool: Pool,
  decision: NewDecision,
  expectedRevision: number | null,
): Promise<SavedDecision | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM change_request WHERE id = $1 FOR UPDATE', [decision.requestId]);

    if (expectedRevision !== null) {
      const cur = await client.query<{ revision: number }>(
        'SELECT COALESCE(MAX(revision), 0)::int AS revision FROM decision WHERE request_id = $1',
        [decision.requestId],
      );
      if (cur.rows[0].revision !== expectedRevision) {
        await client.query('ROLLBACK');
        return null;
      }
    }

    const r = await client.query<SavedDecision>(INSERT_DECISION_SQL, decisionParams(decision));
    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Unconditional save (used by demos and tools). */
export async function saveDecision(pool: Pool, decision: NewDecision): Promise<SavedDecision> {
  return (await insertDecision(pool, decision, null)) as SavedDecision;
}

/** Fenced save: returns null when a newer decision exists than the one the evaluation was based on. */
export function saveDecisionIfCurrent(
  pool: Pool,
  decision: NewDecision,
  baseRevision: number,
): Promise<SavedDecision | null> {
  return insertDecision(pool, decision, baseRevision);
}

/** 0 when the request has no decision yet. */
export async function loadLatestRevision(pool: Pool, requestId: string): Promise<number> {
  const r = await pool.query<{ revision: number }>(
    'SELECT COALESCE(MAX(revision), 0)::int AS revision FROM decision WHERE request_id = $1',
    [requestId],
  );
  return r.rows[0].revision;
}

/** The decision table is append-only: the highest revision is the valid decision. */
export async function loadLatestDecision(
  pool: Pool,
  requestId: string,
): Promise<StoredDecision | null> {
  const r = await pool.query<StoredDecision>(
    `SELECT id, request_id, revision, verdict::text AS verdict, reason_codes, signals,
            decided_by, is_override, created_at
     FROM decision
     WHERE request_id = $1
     ORDER BY revision DESC
     LIMIT 1`,
    [requestId],
  );
  return r.rows[0] ?? null;
}