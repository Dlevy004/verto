import Redis from 'ioredis';
import { Db } from 'mongodb';
import { acquireTriageLock, invalidateDecision, releaseTriageLock } from './decision-cache';
import { saveDecision } from './decision-store';
import { EngineDeps, Evaluation, evaluateRequest, loadRequestInput } from './signals';

export interface TriageDeps extends EngineDeps {
  mongo: Db;
  redis: Redis;
}

export type TriageOutcome =
  | { status: 'busy' } // another triage run holds the lock
  | { status: 'decided'; decisionId: string; evaluation: Evaluation };

/** Lock -> evaluate the five stores -> save the decision -> invalidate the cache -> unlock. */
export async function triageRequest(deps: TriageDeps, requestId: string): Promise<TriageOutcome> {
  const token = await acquireTriageLock(deps.redis, requestId);
  if (!token) return { status: 'busy' };

  try {
    const input = await loadRequestInput(deps.pool, deps.mongo, requestId);
    const evaluation = await evaluateRequest(deps, input);

    const saved = await saveDecision(deps.pool, {
      requestId,
      verdict: evaluation.result.verdict,
      reasonCodes: evaluation.result.reasonCodes,
      // keep the thresholds next to the signals: needed to explain and to tune decisions later
      signals: { signals: evaluation.signals, detail: evaluation.detail, config: deps.config },
      decidedBy: 'ENGINE',
    });

    await invalidateDecision(deps.redis, requestId);
    return { status: 'decided', decisionId: saved.id, evaluation };
  } finally {
    await releaseTriageLock(deps.redis, requestId, token);
  }
}