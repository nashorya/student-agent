import { describe, it, expect } from 'vitest';
import { BoundedBreaker } from '../bounded-breaker.js';
import type { PreferenceCandidate } from '../../memory/candidates/types.js';

function makeCandidate(overrides: Partial<PreferenceCandidate> = {}): PreferenceCandidate {
  return {
    id: 'cand_1',
    pattern: '保持 TypeScript 类型显式',
    scope: 'code-style',
    observations: 2,
    first_observed: '2026-01-01T00:00:00.000Z',
    last_observed: '2026-01-02T00:00:00.000Z',
    contradictions: 0,
    status: 'observed',
    trigger_context: 'test',
    breaker_report: null,
    provenance: [
      {
        source_type: 'reflect-agent',
        task_id: 'task_1',
        session_ref: 'session_1',
        trust_status: 're-observed',
      },
    ],
    ...overrides,
  };
}

describe('BoundedBreaker', () => {
  it('刚达到阈值时返回 moderate 并建议谨慎应用', async () => {
    const breaker = new BoundedBreaker({
      now: () => new Date('2026-01-03T00:00:00.000Z'),
    });

    const decision = await breaker.evaluate({
      candidate: makeCandidate(),
      totalTaskCount: 50,
    });

    expect(decision.action).toBe('promote_with_caution');
    expect(decision.report?.confidence_level).toBe('moderate');
    expect(decision.report?.unknown_risk_zones.length).toBeGreaterThan(0);
  });

  it('存在矛盾观察时拒绝升级', async () => {
    const breaker = new BoundedBreaker();

    const decision = await breaker.evaluate({
      candidate: makeCandidate({ contradictions: 1, observations: 4 }),
      totalTaskCount: 50,
    });

    expect(decision.action).toBe('reject');
    expect(decision.report?.known_failure_context).toContain('候选存在矛盾观察');
  });

  it('超过单轮预算后跳过后续 Breaker', async () => {
    const breaker = new BoundedBreaker({ maxReviewsPerRun: 1 });

    await breaker.evaluate({
      candidate: makeCandidate({ id: 'cand_1', observations: 5 }),
      totalTaskCount: 50,
    });
    const second = await breaker.evaluate({
      candidate: makeCandidate({ id: 'cand_2', observations: 5 }),
      totalTaskCount: 50,
    });

    expect(second.action).toBe('skipped');
    expect(second.report).toBeNull();
  });

  it('提供 merge 入口', async () => {
    const breaker = new BoundedBreaker();

    await expect(breaker.evaluateMerge({
      candidate: makeCandidate({ observations: 5 }),
      totalTaskCount: 50,
    })).resolves.toMatchObject({ action: 'promote' });
  });

  it('generalization 入口要求更高准入门槛', async () => {
    const breaker = new BoundedBreaker();
    await expect(breaker.evaluateGeneralization({
      candidate: makeCandidate({ id: 'cand_2', observations: 5 }),
      totalTaskCount: 50,
      sourceCandidates: [
        makeCandidate({ id: 'source_1' }),
        makeCandidate({ id: 'source_2' }),
      ],
    })).resolves.toMatchObject({
      action: 'reject',
      reason: '泛化准入条件不足',
    });

    await expect(breaker.evaluateGeneralization({
      candidate: makeCandidate({ id: 'cand_3', observations: 5 }),
      totalTaskCount: 50,
      sourceCandidates: [
        makeCandidate({ id: 'source_1', provenance: [{ source_type: 'reflect-agent', task_id: 'task_1', session_ref: 's1', trust_status: 're-observed' }] }),
        makeCandidate({ id: 'source_2', provenance: [{ source_type: 'reflect-agent', task_id: 'task_2', session_ref: 's2', trust_status: 're-observed' }] }),
        makeCandidate({ id: 'source_3', provenance: [{ source_type: 'reflect-agent', task_id: 'task_2', session_ref: 's3', trust_status: 're-observed' }] }),
      ],
    })).resolves.toMatchObject({ action: 'promote' });
  });
});
