import Redis from 'ioredis';
import { Pool } from 'pg';
import { invalidateDecision } from './decision-cache';
import { INSERT_DECISION_SQL, decisionParams } from './decision-store';
import { tryInvalidateDecision } from './decision-cache';

export class RequestNotFoundError extends Error {
  constructor(readonly requestId: string) {
    super(`Change request not found: ${requestId}`);
    this.name = 'RequestNotFoundError';
  }
}

export class NotApprovableError extends Error {
  constructor(
    readonly requestId: string,
    readonly status: string,
  ) {
    super(`Request ${requestId} cannot be approved in status ${status}`);
    this.name = 'NotApprovableError';
  }
}

export class VersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super(`Budget version conflict: expected v${expectedVersion}, current v${currentVersion}`);
    this.name = 'VersionConflictError';
  }
}

export class InsufficientHoursError extends Error {
  constructor(
    readonly requestedHours: number,
    readonly remainingHours: number,
  ) {
    super(`Not enough retainer hours: requested ${requestedHours}, remaining ${remainingHours}`);
    this.name = 'InsufficientHoursError';
  }
}

export interface ApproveInput {
  requestId: string;
  budgetId: string;
  expectedVersion: number; // the budget version the approver saw
  hours: number; // the effort estimate the approver confirmed (multiple of 0.5)
  userId: string;
}

export interface ApproveResult {
  requestId: string;
  hours: number;
  remainingHours: number;
  version: number;
  isOverride: boolean;
}

const APPROVABLE_STATUSES = ['NEEDS_TRIAGE', 'NEEDS_ACTION'];

/**
 * Approves a request in one transaction. The retainer budget is protected by optimistic
 * locking: the UPDATE only matches the version the approver saw and enough remaining hours.
 */
export async function approveRequest(pool: Pool, input: ApproveInput): Promise<ApproveResult> {
  if (!(input.hours > 0) || (input.hours * 2) % 1 !== 0) {
    throw new RangeError('hours must be a positive multiple of 0.5');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) lock the request row, so the same request cannot be approved twice at once
    const req = await client.query<{ project_id: string; status: string }>(
      'SELECT project_id, status::text AS status FROM change_request WHERE id = $1 FOR UPDATE',
      [input.requestId],
    );
    const request = req.rows[0];
    if (!request) throw new RequestNotFoundError(input.requestId);
    if (!APPROVABLE_STATUSES.includes(request.status)) {
      throw new NotApprovableError(input.requestId, request.status);
    }

    // 2) optimistic lock on the retainer budget: version check + enough remaining hours
    const upd = await client.query<{ remaining_hours: number; version: number }>(
      `UPDATE retainer_budget
          SET remaining_hours = remaining_hours - $1, version = version + 1
        WHERE id = $2 AND project_id = $3 AND version = $4 AND remaining_hours >= $1
        RETURNING remaining_hours::float8 AS remaining_hours, version`,
      [input.hours, input.budgetId, request.project_id, input.expectedVersion],
    );

    if (upd.rowCount === 0) {
      // Find out why: a stale version means a concurrent change, otherwise the budget is too small.
      const cur = await client.query<{ remaining_hours: number; version: number }>(
        `SELECT remaining_hours::float8 AS remaining_hours, version
           FROM retainer_budget WHERE id = $1 AND project_id = $2`,
        [input.budgetId, request.project_id],
      );
      const budget = cur.rows[0];
      if (!budget) {
        throw new Error(`Budget ${input.budgetId} does not belong to the project of this request`);
      }
      if (budget.version !== input.expectedVersion) {
        throw new VersionConflictError(input.expectedVersion, budget.version);
      }
      throw new InsufficientHoursError(input.hours, budget.remaining_hours);
    }
    const after = upd.rows[0];

    // 3) the manual approval overrides every engine verdict other than IN_SCOPE
    const latest = await client.query<{ verdict: string }>(
      `SELECT verdict::text AS verdict FROM decision
        WHERE request_id = $1 ORDER BY revision DESC LIMIT 1`,
      [input.requestId],
    );
    const isOverride = (latest.rows[0]?.verdict ?? null) !== 'IN_SCOPE';

    // 4) reservation, decision, status and audit log, all in the same transaction
    await client.query(
      'INSERT INTO hours_reservation (request_id, budget_id, hours) VALUES ($1, $2, $3)',
      [input.requestId, input.budgetId, input.hours],
    );
    await client.query(
      INSERT_DECISION_SQL,
      decisionParams({
        requestId: input.requestId,
        verdict: 'IN_SCOPE',
        reasonCodes: ['MANUAL_APPROVAL'],
        signals: { approvedHours: input.hours, budgetVersionAfter: after.version },
        decidedBy: input.userId,
        isOverride,
      }),
    );
    await client.query(
      `UPDATE change_request
          SET status = 'APPROVED', estimated_hours = $2, updated_at = now()
        WHERE id = $1`,
      [input.requestId, input.hours],
    );
    await client.query(
      `INSERT INTO audit_log (project_id, request_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'APPROVE_REQUEST', $4::jsonb)`,
      [
        request.project_id,
        input.requestId,
        input.userId,
        JSON.stringify({
          hours: input.hours,
          budgetId: input.budgetId,
          versionBefore: input.expectedVersion,
          versionAfter: after.version,
          isOverride,
        }),
      ],
    );

    await client.query('COMMIT');
    return {
      requestId: input.requestId,
      hours: input.hours,
      remainingHours: after.remaining_hours,
      version: after.version,
      isOverride,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Approves, then drops the cached decision of the request (after the commit). */
export interface ApproveAndRefreshResult extends ApproveResult {
  cacheInvalidated: boolean;
  cacheError?: string;
}

/**
 * Approves, then drops the cached decision of the request (after the commit).
 * A cache failure is reported in the result, it never turns a committed approval into an error.
 * Recovery: call invalidateDecision again; do NOT repeat the approval.
 */
export async function approveAndRefreshCache(
  pool: Pool,
  redis: Redis,
  input: ApproveInput,
): Promise<ApproveAndRefreshResult> {
  const result = await approveRequest(pool, input);
  const invalidation = await tryInvalidateDecision(redis, input.requestId);
  // Note: other open requests of the project may now exceed the remaining hours;
  // re-triaging them is a separate step (not part of this change).
  return { ...result, cacheInvalidated: invalidation.ok, cacheError: invalidation.error };
}