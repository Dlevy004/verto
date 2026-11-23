import { DecisionConfig } from './decide';

/**
 * Baseline decision engine parameters prior to empirical threshold tuning.
 * `thetaDup` is initialized at `0.75` based on smoke-test paraphrase cosine scores (~0.78).
 */
export const ENGINE_CONFIG: DecisionConfig = {
  thetaScope: 0.5,
  thetaDup: 0.75,
  topK: 5,
  hoursPerModule: 1.5,
  baseHours: { FEATURE: 6, BUG: 2, UI_UX: 4, CONTENT: 2, TECHNICAL: 5 },
};