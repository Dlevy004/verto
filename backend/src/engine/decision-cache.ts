import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { loadLatestDecision } from './decision-store';

export const DECISION_TTL_SECONDS = 300;
export const LOCK_TTL_MS = 30_000;

export const decisionKey = (requestId: string) => `request:${requestId}:decision`;
export const lockKey = (requestId: string) => `triage_lock:${requestId}`;

/** A cached copy of the latest decision row; it keeps the source id and the refresh time. */
export interface CachedDecision {
  verdict: string;
  reason_codes: string[];
  signals: unknown;
  decided_by: string;
  is_override: boolean;
  decided_at: string; // ISO time of the decision row
  source_id: string; // the change request id
  refreshed_at: string; // ISO time when this cache entry was written
}

export interface DecisionRead {
  decision: CachedDecision | null;
  source: 'cache' | 'postgres';
}

/** Cache-aside read: Redis first, PostgreSQL on a miss, then the entry is cached with a TTL. */
export async function getDecision(
  redis: Redis,
  pool: Pool,
  requestId: string,
): Promise<DecisionRead> {
  const raw = await redis.get(decisionKey(requestId));
  if (raw) {
    return { decision: JSON.parse(raw) as CachedDecision, source: 'cache' };
  }

  const stored = await loadLatestDecision(pool, requestId);
  if (!stored) return { decision: null, source: 'postgres' };

  const entry: CachedDecision = {
    verdict: stored.verdict,
    reason_codes: stored.reason_codes,
    signals: stored.signals,
    decided_by: stored.decided_by,
    is_override: stored.is_override,
    decided_at: stored.created_at.toISOString(),
    source_id: requestId,
    refreshed_at: new Date().toISOString(),
  };
  await redis.set(decisionKey(requestId), JSON.stringify(entry), 'EX', DECISION_TTL_SECONDS);
  return { decision: entry, source: 'postgres' };
}

/** Call this in every path that changes the decision, AFTER the database commit. */
export async function invalidateDecision(redis: Redis, requestId: string): Promise<void> {
  await redis.del(decisionKey(requestId));
}

/** Drops every cached decision. Always safe: the cache is rebuilt on demand. */
export async function clearDecisionCache(redis: Redis): Promise<number> {
  let deleted = 0;
  const stream = redis.scanStream({ match: 'request:*:decision', count: 200 });
  for await (const keys of stream as unknown as AsyncIterable<string[]>) {
    if (keys.length > 0) deleted += await redis.del(...keys);
  }
  return deleted;
}

/** Returns an owner token when the lock was acquired, null when someone else holds it. */
export async function acquireTriageLock(redis: Redis, requestId: string): Promise<string | null> {
  const token = randomUUID();
  const ok = await redis.set(lockKey(requestId), token, 'PX', LOCK_TTL_MS, 'NX');
  return ok === 'OK' ? token : null;
}

// Only the owner may release the lock: compare the token and delete atomically.
const RELEASE_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end`;

export async function releaseTriageLock(
  redis: Redis,
  requestId: string,
  token: string,
): Promise<boolean> {
  const released = await redis.eval(RELEASE_SCRIPT, 1, lockKey(requestId), token);
  return released === 1;
}