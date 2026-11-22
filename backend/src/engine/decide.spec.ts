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
  it('valid request: IN_SCOPE', () => {
    expect(run({})).toEqual({ verdict: 'IN_SCOPE', reasonCodes: ['IN_SCOPE_OK'] });
  });

  it('duplicate: REJECTED', () => {
    expect(run({ dupSim: 0.9, dupRequestId: 'drq-0001' })).toEqual({
      verdict: 'REJECTED',
      reasonCodes: ['DUPLICATE'],
    });
  });

  it('duplicate takes precedence over everything else', () => {
    const r = run({ dupSim: 0.9, scopeSim: 0.1, estHours: 99, blockers: 3 });
    expect(r.reasonCodes).toEqual(['DUPLICATE']);
  });

  it('warranty bug: IN_SCOPE, even over retainer', () => {
    const r = run({ type: 'BUG', regressionOfDelivered: true, estHours: 99, scopeSim: 0.1 });
    expect(r).toEqual({ verdict: 'IN_SCOPE', reasonCodes: ['WARRANTY_BUG'] });
  });

  it('non-warranty bug follows normal rules', () => {
    const r = run({ type: 'BUG', regressionOfDelivered: false, estHours: 99 });
    expect(r.reasonCodes).toEqual(['OVER_RETAINER']);
  });

  it('request similar to excluded passage: SCOPE_CREEP', () => {
    expect(run({ scopeKind: 'EXCLUDED', scopeSim: 0.7 })).toEqual({
      verdict: 'SCOPE_CREEP',
      reasonCodes: ['EXCLUDED_BY_CONTRACT'],
    });
  });

  it('low similarity to contract: OUT_OF_SCOPE', () => {
    expect(run({ scopeSim: 0.3 })).toEqual({
      verdict: 'SCOPE_CREEP',
      reasonCodes: ['OUT_OF_SCOPE'],
    });
  });

  it('missing vector signal: OUT_OF_SCOPE', () => {
    expect(run({ scopeSim: null, scopeKind: null }).reasonCodes).toEqual(['OUT_OF_SCOPE']);
  });

  it('request over retainer: SCOPE_CREEP', () => {
    expect(run({ estHours: 15.5, remainingHours: 3.5 })).toEqual({
      verdict: 'SCOPE_CREEP',
      reasonCodes: ['OVER_RETAINER'],
    });
  });

  it('hours matching exact retainer limit still fit', () => {
    expect(run({ estHours: 10, remainingHours: 10 }).verdict).toBe('IN_SCOPE');
  });

  it('frozen module: REQUIRES_ALIGNMENT', () => {
    expect(run({ blockers: 1 })).toEqual({
      verdict: 'REQUIRES_ALIGNMENT',
      reasonCodes: ['FROZEN_MODULES'],
    });
  });

  it('out-of-scope takes precedence over frozen module', () => {
    expect(run({ scopeSim: 0.2, blockers: 2 }).reasonCodes).toEqual(['OUT_OF_SCOPE']);
  });
});

describe('estimateHours', () => {
  it('base + 1.5 hours per module', () => {
    expect(estimateHours('FEATURE', 3, ENGINE_CONFIG)).toBe(10.5);
    expect(estimateHours('BUG', 0, ENGINE_CONFIG)).toBe(2);
  });
});