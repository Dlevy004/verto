import { DecisionConfig } from './decide';

// Kezdő értékek: a hangolás ELŐTTI futás számait ezekkel mérjük, és elmentjük.
// A thetaDup a smoke-teszt alapján 0.75 (egy parafrázis-pár koszinusza ~0.78 volt).
export const ENGINE_CONFIG: DecisionConfig = {
  thetaScope: 0.5,
  thetaDup: 0.75,
  topK: 5,
  hoursPerModule: 1.5,
  baseHours: { FEATURE: 6, BUG: 2, UI_UX: 4, CONTENT: 2, TECHNICAL: 5 },
};