import { DecisionSignals, decide, estimateHours } from './decide';
import { ENGINE_CONFIG } from './engine.config';

const base: DecisionSignals = {
  type: 'FEATURE',
  scopeSim: 0.8,
  scopePassageId: 'dcp-0001',
  scopeKind: 'INCLUDED',
  dupSim: 0.2,
  dupRequestId: null,
  affectedModules: 2,
  blockers: 0,
  estHours: 4,
  remainingHours: 10,
  regressionOfDelivered: false,
};
const run = (over: Partial<DecisionSignals>) => decide({ ...base, ...over }, ENGINE_CONFIG);

describe('decide', () => {
  it('rendben lévő kérés: IN_SCOPE', () => {
    expect(run({})).toEqual({ verdict: 'IN_SCOPE', reasonCodes: ['IN_SCOPE_OK'] });
  });

  it('duplikátum: REJECTED', () => {
    expect(run({ dupSim: 0.9, dupRequestId: 'drq-0001' })).toEqual({
      verdict: 'REJECTED',
      reasonCodes: ['DUPLICATE'],
    });
  });

  it('a duplikátum minden mást megelőz', () => {
    const r = run({ dupSim: 0.9, scopeSim: 0.1, estHours: 99, blockers: 3 });
    expect(r.reasonCodes).toEqual(['DUPLICATE']);
  });

  it('garanciális hiba: IN_SCOPE, a kereten felül is', () => {
    const r = run({ type: 'BUG', regressionOfDelivered: true, estHours: 99, scopeSim: 0.1 });
    expect(r).toEqual({ verdict: 'IN_SCOPE', reasonCodes: ['WARRANTY_BUG'] });
  });

  it('nem garanciális hiba a normál szabályokat követi', () => {
    const r = run({ type: 'BUG', regressionOfDelivered: false, estHours: 99 });
    expect(r.reasonCodes).toEqual(['OVER_RETAINER']);
  });

  it('kizárt passzushoz hasonló kérés: SCOPE_CREEP', () => {
    expect(run({ scopeKind: 'EXCLUDED', scopeSim: 0.7 })).toEqual({
      verdict: 'SCOPE_CREEP',
      reasonCodes: ['EXCLUDED_BY_CONTRACT'],
    });
  });

  it('kis hasonlóság a szerződéssel: OUT_OF_SCOPE', () => {
    expect(run({ scopeSim: 0.3 })).toEqual({
      verdict: 'SCOPE_CREEP',
      reasonCodes: ['OUT_OF_SCOPE'],
    });
  });

  it('hiányzó vektor-jelzés: OUT_OF_SCOPE', () => {
    expect(run({ scopeSim: null, scopeKind: null }).reasonCodes).toEqual(['OUT_OF_SCOPE']);
  });

  it('keret feletti kérés: SCOPE_CREEP', () => {
    expect(run({ estHours: 15.5, remainingHours: 3.5 })).toEqual({
      verdict: 'SCOPE_CREEP',
      reasonCodes: ['OVER_RETAINER'],
    });
  });

  it('pontosan a keretnek megfelelő óra még belefér', () => {
    expect(run({ estHours: 10, remainingHours: 10 }).verdict).toBe('IN_SCOPE');
  });

  it('befagyasztott modul: REQUIRES_ALIGNMENT', () => {
    expect(run({ blockers: 1 })).toEqual({
      verdict: 'REQUIRES_ALIGNMENT',
      reasonCodes: ['FROZEN_MODULES'],
    });
  });

  it('a szerződésen kívüliség megelőzi a befagyasztott modult', () => {
    expect(run({ scopeSim: 0.2, blockers: 2 }).reasonCodes).toEqual(['OUT_OF_SCOPE']);
  });
});

describe('estimateHours', () => {
  it('alap + modulonként 1.5 óra', () => {
    expect(estimateHours('FEATURE', 3, ENGINE_CONFIG)).toBe(10.5);
    expect(estimateHours('BUG', 0, ENGINE_CONFIG)).toBe(2);
  });
});