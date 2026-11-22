import Redis from 'ioredis';
import { Db } from 'mongodb';
import { acquireTriageLock, releaseTriageLock, tryInvalidateDecision } from './decision-cache';
import { loadLatestRevision, saveDecisionIfCurrent } from './decision-store';
import { EngineDeps, Evaluation, evaluateRequest, loadRequestInput } from './signals';

export interface TriageDeps extends EngineDeps {
  mongo: Db;
  redis: Redis;
}

export type TriageOutcome =
  | { status: 'busy' } // another triage run holds the lock
  | { status: 'superseded' } // a newer decision (manual approval or another triage) won the race
  | {
      status: 'decided';
      decisionId: string;
      revision: number;
      evaluation: Evaluation;
      cacheInvalidated: boolean;
    };

/**
 * Lock -> evaluate the five stores -> fenced save -> invalidate the cache -> unlock.
 *
 * The Redis lock only avoids duplicate work. Correctness comes from the fenced save: the
 * decision is written only if no other decision (a manual approval, a newer triage run, or a
 * run that took over after this lock expired) was added since this evaluation started.
 */
export async function triageRequest(deps: TriageDeps, requestId: string): Promise<TriageOutcome> {
  const token = await acquireTriageLock(deps.redis, requestId);
  if (!token) return { status: 'busy' };

  try {
    const baseRevision = await loadLatestRevision(deps.pool, requestId);
    const input = await loadRequestInput(deps.pool, deps.mongo, requestId);
    const evaluation = await evaluateRequest(deps, input);

    const saved = await saveDecisionIfCurrent(
      deps.pool,
      {
        requestId,
        verdict: evaluation.result.verdict,
        reasonCodes: evaluation.result.reasonCodes,
        // keep the thresholds next to the signals: needed to explain and to tune decisions later
        signals: { signals: evaluation.signals, detail: evaluation.detail, config: deps.config },
        decidedBy: 'ENGINE',
      },
      baseRevision,
    );
    if (!saved) return { status: 'superseded' };

    const invalidation = await tryInvalidateDecision(deps.redis, requestId);
    return {
      status: 'decided',
      decisionId: saved.id,
      revision: saved.revision,
      evaluation,
      cacheInvalidated: invalidation.ok,
    };
  } finally {
    await releaseTriageLock(deps.redis, requestId, token);
  }
}