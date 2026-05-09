import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteQueue } from '../../../core/write-queue.js';
import { DesignMemoryManager } from '../manager.js';
import type { DesignCritique, DesignExtractionResult } from '../types.js';

function extraction(name = 'Food App'): DesignExtractionResult {
  return {
    name,
    sourceUrls: ['https://example.com'],
    screenshots: [{ viewport: 'desktop', width: 1440, height: 900, dataUrl: 'data:image/png;base64,AAA' }],
    samples: [
      {
        role: 'button',
        selector: 'button',
        viewport: 'desktop',
        styles: {
          color: '#111111',
          backgroundColor: '#ffd23f',
          border: '3px solid #111111',
          borderRadius: '16px',
          boxShadow: '4px 4px 0 #111111',
          fontWeight: '900',
        },
      },
    ],
    tokens: {
      colors: {
        ink: '#111111',
        background: ['#fffdf8'],
        text: ['#111111'],
        accent: ['#ffd23f'],
      },
      border: { default: '3px solid #111111' },
      shadow: ['4px 4px 0 #111111'],
      radius: ['16px'],
      fontWeight: { heading: 900, button: 900 },
    },
    componentPatterns: {
      button: 'thick border with hard shadow',
    },
    antiPatterns: ['glassmorphism'],
    provenanceSource: 'playwright-design-study',
  };
}

function critique(profileId: string): DesignCritique {
  return {
    id: 'critique_1',
    task_id: 'task_1',
    profile_id: profileId,
    url: 'http://localhost:3000',
    score: 0.6,
    scores: {
      color_match: 0.8,
      border_shadow_match: 0.2,
      typography_match: 0.7,
      component_consistency: 0.5,
      layout_density: 0.8,
      mobile_stability: 0.6,
    },
    failures: ['buttons used soft shadows'],
    revision_required: true,
    screenshot_refs: [],
    created_at: '2026-05-08T00:00:00.000Z',
    provenance: {
      source_type: 'playwright-visual-critic',
      task_id: 'task_1',
      session_ref: 'session_1',
      created_at: '2026-05-08T00:00:00.000Z',
      trust_status: 'unverified',
    },
  };
}

describe('DesignMemoryManager', () => {
  let tmpDir: string;
  let mgr: DesignMemoryManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'design-memory-test-'));
    DesignMemoryManager.resetInstance();
    WriteQueue.resetInstance();
    mgr = DesignMemoryManager.getInstance(tmpDir);
  });

  afterEach(async () => {
    DesignMemoryManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('observes a new design candidate', async () => {
    const candidate = await mgr.observeCandidate(extraction(), {
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    expect(candidate.name).toBe('Food App');
    expect(candidate.status).toBe('observed');
    expect(candidate.provenance[0].source_type).toBe('playwright-design-study');
    expect(await mgr.getCandidates()).toHaveLength(1);
  });

  it('deduplicates repeated observations and marks re-observed', async () => {
    await mgr.observeCandidate(extraction(), { taskId: 'task_1', sessionRef: 'session_1' });
    await mgr.observeCandidate(extraction(), { taskId: 'task_2', sessionRef: 'session_2' });

    const candidates = await mgr.getCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].observations).toBe(2);
    expect(candidates[0].provenance[1].trust_status).toBe('re-observed');
  });

  it('confirms candidate into profile and sets it active', async () => {
    const candidate = await mgr.observeCandidate(extraction(), {
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    const profile = await mgr.confirmCandidate(candidate.id, {
      taskId: 'task_2',
      sessionRef: 'session_2',
    });
    await mgr.setActiveProfile(profile.id);

    expect(profile.id).toBe('food-app');
    expect((await mgr.findCandidate(candidate.id))?.status).toBe('promoted');
    expect((await mgr.getActiveProfile())?.id).toBe('food-app');
  });

  it('records a breaker report on a design candidate', async () => {
    const candidate = await mgr.observeCandidate(extraction(), {
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    await mgr.recordBreakerReport(candidate.id, {
      id: 'breaker_1',
      confidence_level: 'moderate',
      breakers_applied: ['mobile-density-test'],
      known_failure_context: [],
      unknown_risk_zones: ['dense lists'],
      recommendation: 'promote_with_caution',
      created_at: '2026-05-08T00:00:00.000Z',
    });

    expect((await mgr.findCandidate(candidate.id))?.breaker_report?.id).toBe('breaker_1');
  });

  it('stores local URL and unresolved critiques', async () => {
    const candidate = await mgr.observeCandidate(extraction(), {
      taskId: 'task_1',
      sessionRef: 'session_1',
    });
    const profile = await mgr.confirmCandidate(candidate.id, {
      taskId: 'task_2',
      sessionRef: 'session_2',
    });

    await mgr.setLocalUrl('http://localhost:3000');
    await mgr.appendCritique(critique(profile.id));

    expect(await mgr.getLocalUrl()).toBe('http://localhost:3000');
    expect(await mgr.getRecentUnresolvedCritiques()).toHaveLength(1);
  });

  it('serializes concurrent active profile and local URL updates', async () => {
    const candidate = await mgr.observeCandidate(extraction(), {
      taskId: 'task_1',
      sessionRef: 'session_1',
    });
    const profile = await mgr.confirmCandidate(candidate.id, {
      taskId: 'task_2',
      sessionRef: 'session_2',
    });

    await Promise.all([
      mgr.setActiveProfile(profile.id),
      mgr.setLocalUrl('http://localhost:3000'),
    ]);

    expect((await mgr.getActiveProfile())?.id).toBe(profile.id);
    expect(await mgr.getLocalUrl()).toBe('http://localhost:3000');
  });

  it('serializes concurrent candidate writes', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        mgr.observeCandidate(extraction(`Profile ${index}`), {
          taskId: `task_${index}`,
          sessionRef: `session_${index}`,
        }),
      ),
    );

    expect(await mgr.getCandidates()).toHaveLength(5);
  });

  it('copies a confirmed profile to another design memory manager', async () => {
    const otherDir = await mkdtemp(join(tmpdir(), 'design-global-test-'));
    try {
      const candidate = await mgr.observeCandidate(extraction(), {
        taskId: 'task_1',
        sessionRef: 'session_1',
      });
      const profile = await mgr.confirmCandidate(candidate.id, {
        taskId: 'task_2',
        sessionRef: 'session_2',
      });
      const globalMgr = new DesignMemoryManager(otherDir);

      const copied = await mgr.copyProfileTo(profile.id, globalMgr);

      expect(copied.id).toBe(profile.id);
      expect((await globalMgr.getProfile(profile.id))?.name).toBe(profile.name);
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});
