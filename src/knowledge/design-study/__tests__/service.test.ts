import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteQueue } from '../../../core/write-queue.js';
import { DesignMemoryManager } from '../../../memory/design/manager.js';
import { DesignStudyService } from '../service.js';
import type { DesignExtractor } from '../types.js';

const extractor: DesignExtractor = {
  extract: async (request) => ({
    name: request.name ?? 'Reference',
    sourceUrls: [request.url],
    screenshots: [],
    samples: [],
    tokens: {
      colors: { background: [], text: [], accent: [] },
      border: {},
      shadow: [],
      radius: [],
      fontWeight: {},
    },
    componentPatterns: {},
    antiPatterns: [],
    provenanceSource: 'playwright-design-study',
  }),
};

describe('DesignStudyService', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'design-service-test-'));
    DesignMemoryManager.resetInstance();
    WriteQueue.resetInstance();
  });

  afterEach(async () => {
    DesignMemoryManager.resetInstance();
    WriteQueue.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('studies a URL and persists a candidate', async () => {
    const memory = DesignMemoryManager.getInstance(tmpDir);
    const service = new DesignStudyService({
      memory,
      nativeExtractor: extractor,
      extractorMode: 'native',
    });

    const candidate = await service.study({
      url: 'https://example.com',
      name: 'Reference',
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    expect(candidate.name).toBe('Reference');
    expect(candidate.breaker_report?.breakers_applied).toContain('mobile-density-test');
    expect(await memory.getCandidates()).toHaveLength(1);
  });

  it('accepts reference study URLs without the Playwright whitelist', async () => {
    const memory = DesignMemoryManager.getInstance(tmpDir);
    const service = new DesignStudyService({
      memory,
      nativeExtractor: extractor,
      extractorMode: 'native',
    });

    const candidate = await service.study({
      url: 'http://localhost:3000',
      name: 'Localhost',
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    expect(candidate.name).toBe('Localhost');
  });

  it('rejects non-http reference study URLs', async () => {
    const memory = DesignMemoryManager.getInstance(tmpDir);
    const service = new DesignStudyService({
      memory,
      nativeExtractor: extractor,
      extractorMode: 'native',
    });

    await expect(service.study({
      url: 'file:///tmp/design.html',
      name: 'File',
      taskId: 'task_1',
      sessionRef: 'session_1',
    })).rejects.toThrow(/仅允许 http\/https/);
  });
});
