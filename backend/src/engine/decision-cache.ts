import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { StoredDecision, loadLatestDecision } from './decision-store';

export const DECISION_TTL_SECONDS = 300;
export const GENERATION_TTL_SECONDS = 86_400;
export const LOCK_TTL_MS = 30_000;

export const decisionKey = (requestId: string) => `request:${requestId}:decision`;
export const generationKey = (requestId: string) => `request:${requestId}:gen`;
export const lockKey = (requestId: string) => `triage_lock:${requestId}`;

/** A cached copy of the latest decision row; it keeps the source id and the refresh time. */
export interface CachedDecision {
  verdict: string;
  revision: number;
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
  cached: boolean; // true when the entry is in the cache (served from it, or published by this read)
}

export function toCachedDecision(stored: StoredDecision): CachedDecision {
  return {
    verdict: stored.verdict,
    revision: stored.revision,
    reason_codes: stored.reason_codes,
    signals: stored.signals,
    decided_by: stored.decided_by,
    is_override: stored.is_override,
    decided_at: stored.created_at.toISOString(),
    source_id: stored.request_id,
    refreshed_at: new Date().toISOString(),
  };
}

// Publishes the entry only if the generation did not change since the reader noted it.
const FENCED_FILL_SCRIPT = `
  local generation = redis.call('get', KEYS[1]) or '0'
  if generation == ARGV[1] then
    redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3])
    return 1
  end
  return 0`;

// Bumps the generation (which fences in-flight fills) and deletes the cached value atomically.
const INVALIDATE_SCRIPT = `
  redis.call('incr', KEYS[1])
  redis.call('expire', KEYS[1], ARGV[1])
  redis.call('del', KEYS[2])
  return 1`;

export async function readGeneration(redis: Redis, requestId: string): Promise<string> {
  return (await redis.get(generationKey(requestId))) ?? '0';
}

/** Returns false when an invalidation happened after `generation` was read: the entry is not published. */
export async function fillDecisionCache(
  redis: Redis,
  requestId: string,
  generation: string,
  entry: CachedDecision,
): Promise<boolean> {
  const published = await redis.eval(
    FENCED_FILL_SCRIPT,
    2,
    generationKey(requestId),
    decisionKey(requestId),
    generation,
    JSON.stringify(entry),
    String(DECISION_TTL_SECONDS),
  );
  return published === 1;
}

/** Cache-aside read: Redis first, PostgreSQL on a miss, then a fenced fill with a TTL. */
export async function getDecision(
  redis: Redis,
  pool: Pool,
  requestId: string,
): Promise<DecisionRead> {
  const raw = await redis.get(decisionKey(requestId));
  if (raw) {
    return { decision: JSON.parse(raw) as CachedDecision, source: 'cache', cached: true };
  }

  // Note the generation BEFORE the database read: an invalidation in between bumps it,
  // and the fill below is rejected instead of publishing an older value.
  const generation = await readGeneration(redis, requestId);
  const stored = await loadLatestDecision(pool, requestId);
  if (!stored) return { decision: null, source: 'postgres', cached: false };

  const entry = toCachedDecision(stored);
  const cached = await fillDecisionCache(redis, requestId, generation, entry);
  return { decision: entry, source: 'postgres', cached };
}

/** Call this in every path that changes the decision, AFTER the database commit. */
export async function invalidateDecision(redis: Redis, requestId: string): Promise<void> {
  await redis.eval(
    INVALIDATE_SCRIPT,
    2,
    generationKey(requestId),
    decisionKey(requestId),
    String(GENERATION_TTL_SECONDS),
  );
}

export interface InvalidationOutcome {
  ok: boolean;
  error?: string;
}

/**
 * For paths where the database change is already committed: a cache failure must not look like
 * a failed operation. Recovery is idempotent: call invalidateDecision again; the TTL bounds
 * how long a stale entry can live anyway.
 */
export async function tryInvalidateDecision(
  redis: Redis,
  requestId: string,
): Promise<InvalidationOutcome> {
  try {
    await invalidateDecision(redis, requestId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Drops every cached decision and generation. Always safe: the cache is rebuilt on demand. */
export async function clearDecisionCache(redis: Redis): Promise<number> {
  let deleted = 0;
  for (const pattern of ['request:*:decision', 'request:*:gen']) {
    const stream = redis.scanStream({ match: pattern, count: 200 });
    for await (const keys of stream as unknown as AsyncIterable<string[]>) {
      if (keys.length > 0) deleted += await redis.del(...keys);
    }
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