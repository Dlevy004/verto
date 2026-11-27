export type RequestType = 'FEATURE' | 'BUG' | 'UI_UX' | 'CONTENT' | 'TECHNICAL';
export type Verdict = 'IN_SCOPE' | 'SCOPE_CREEP' | 'REQUIRES_ALIGNMENT' | 'REJECTED';
export type ReasonCode =
  | 'DUPLICATE'
  | 'WARRANTY_BUG'
  | 'EXCLUDED_BY_CONTRACT'
  | 'OUT_OF_SCOPE'
  | 'OVER_RETAINER'
  | 'FROZEN_MODULES'
  | 'IN_SCOPE_OK';

/** Tunable thresholds and effort estimation parameters for the decision engine. */
export interface DecisionConfig {
  /** Minimum cosine similarity to a contract passage required to stay in scope. */
  thetaScope: number;
  /** Minimum cosine similarity to a prior active request to classify as a duplicate. */
  thetaDup: number;
  /** Number of nearest contract passages retrieved during semantic search. */
  topK: number;
  /** Additional effort hours added per directly or transitively affected module. */
  hoursPerModule: number;
  /** Baseline effort hours per request category before module impact. */
  baseHours: Record<RequestType, number>;
}

/** Normalized polyglot signals aggregated from all persistence stores for a single request. */
export interface DecisionSignals {
  type: RequestType;
  // Vector store signals (pgvector / Qdrant)
  scopeSim: number | null;
  scopePassageId: string | null;
  scopeKind: 'INCLUDED' | 'EXCLUDED' | null;
  dupSim: number | null;
  dupRequestId: string | null;
  // Graph store signals (Neo4j)
  affectedModules: number;
  blockers: number;
  // Relational store signals (PostgreSQL)
  estHours: number;
  remainingHours: number;
  // Document store signals (MongoDB)
  regressionOfDelivered: boolean;
}

export interface DecisionResult {
  verdict: Verdict;
  reasonCodes: ReasonCode[];
}

/**
 * Estimates engineering effort in hours (`baseHours[type] + hoursPerModule * affectedModules`),
 * rounded to the nearest 0.5-hour increment.
 */
export function estimateHours(
  type: RequestType,
  affectedModules: number,
  cfg: DecisionConfig,
): number {
  const raw = cfg.baseHours[type] + cfg.hoursPerModule * affectedModules;
  return Math.round(raw * 2) / 2;
}

/**
 * Evaluates a change request deterministically against ordered business rules.
 * Rules are applied sequentially; the first matching rule determines the outcome.
 */
export function decide(s: DecisionSignals, cfg: DecisionConfig): DecisionResult {
  // 1) Duplicate check takes highest precedence
  if (s.dupSim !== null && s.dupSim >= cfg.thetaDup) {
    return { verdict: 'REJECTED', reasonCodes: ['DUPLICATE'] };
  }

  // 2) Regressions on already delivered functionality are covered under warranty
  if (s.type === 'BUG' && s.regressionOfDelivered) {
    return { verdict: 'IN_SCOPE', reasonCodes: ['WARRANTY_BUG'] };
  }

  // 3) Contract alignment: low similarity or explicit exclusion indicates scope creep
  if (s.scopeSim === null || s.scopeSim < cfg.thetaScope) {
    return { verdict: 'SCOPE_CREEP', reasonCodes: ['OUT_OF_SCOPE'] };
  }
  if (s.scopeKind === 'EXCLUDED') {
    return { verdict: 'SCOPE_CREEP', reasonCodes: ['EXCLUDED_BY_CONTRACT'] };
  }

  // 4) Monthly retainer capacity check
  if (s.estHours > s.remainingHours) {
    return { verdict: 'SCOPE_CREEP', reasonCodes: ['OVER_RETAINER'] };
  }

  // 5) Dependency impact on frozen modules requires manual stakeholder alignment
  if (s.blockers > 0) {
    return { verdict: 'REQUIRES_ALIGNMENT', reasonCodes: ['FROZEN_MODULES'] };
  }

  // 6) All checks passed
  return { verdict: 'IN_SCOPE', reasonCodes: ['IN_SCOPE_OK'] };
}