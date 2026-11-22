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

export interface DecisionConfig {
  thetaScope: number; // ennél kisebb hasonlóság a szerződéssel: szerződésen kívüli
  thetaDup: number; // ennél nagyobb hasonlóság egy korábbi kéréssel: duplikátum
  topK: number; // hány passzust kérünk a vektorkeresésből
  hoursPerModule: number;
  baseHours: Record<RequestType, number>;
}

/** Az öt tár jelzései egy kéréshez. */
export interface DecisionSignals {
  type: RequestType;
  // vektortár
  scopeSim: number | null;
  scopePassageId: string | null;
  scopeKind: 'INCLUDED' | 'EXCLUDED' | null;
  dupSim: number | null;
  dupRequestId: string | null;
  // Neo4j
  affectedModules: number;
  blockers: number;
  // Postgres
  estHours: number;
  remainingHours: number;
  // Mongo
  regressionOfDelivered: boolean;
}

export interface DecisionResult {
  verdict: Verdict;
  reasonCodes: ReasonCode[];
}

/** Becsült órák: alap + modulonként. Félórás lépésre kerekítve. */
export function estimateHours(
  type: RequestType,
  affectedModules: number,
  cfg: DecisionConfig,
): number {
  const raw = cfg.baseHours[type] + cfg.hoursPerModule * affectedModules;
  return Math.round(raw * 2) / 2;
}

/** A szabályok sorrendben, az első illeszkedő nyer. */
export function decide(s: DecisionSignals, cfg: DecisionConfig): DecisionResult {
  // 1) duplikátum
  if (s.dupSim !== null && s.dupSim >= cfg.thetaDup) {
    return { verdict: 'REJECTED', reasonCodes: ['DUPLICATE'] };
  }

  // 2) a már átadott funkció hibája garanciális, nem terheli a keretet
  if (s.type === 'BUG' && s.regressionOfDelivered) {
    return { verdict: 'IN_SCOPE', reasonCodes: ['WARRANTY_BUG'] };
  }

  // 3) a szerződéshez való viszony
  if (s.scopeSim === null || s.scopeSim < cfg.thetaScope) {
    return { verdict: 'SCOPE_CREEP', reasonCodes: ['OUT_OF_SCOPE'] };
  }
  if (s.scopeKind === 'EXCLUDED') {
    return { verdict: 'SCOPE_CREEP', reasonCodes: ['EXCLUDED_BY_CONTRACT'] };
  }

  // 4) óra-keret
  if (s.estHours > s.remainingHours) {
    return { verdict: 'SCOPE_CREEP', reasonCodes: ['OVER_RETAINER'] };
  }

  // 5) befagyasztott modulok
  if (s.blockers > 0) {
    return { verdict: 'REQUIRES_ALIGNMENT', reasonCodes: ['FROZEN_MODULES'] };
  }

  // 6) minden rendben
  return { verdict: 'IN_SCOPE', reasonCodes: ['IN_SCOPE_OK'] };
}