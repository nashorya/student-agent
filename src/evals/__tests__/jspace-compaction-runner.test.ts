import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildJspaceFeatureManifest,
  noOpNeutralityResult,
  writeJspaceRunArtifacts,
} from '../jspace-compaction-runner.js';

const outputDirs: string[] = [];

afterEach(async () => {
  await Promise.all(outputDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('J-space compaction probe arm isolation', () => {
  it('keeps every model-facing context runtime feature disabled in the plain arm', () => {
    expect(buildJspaceFeatureManifest('plain')).toEqual({
      arm: 'plain',
      piBuiltInCompaction: true,
      contextRuntime: false,
      memorySystemPrefix: false,
      taskLedgerModelInjection: false,
      recallModelInjection: false,
      checkpointInjection: false,
      jspaceInjection: false,
    });
  });

  it('records the repository context runtime features in the current arm', () => {
    expect(buildJspaceFeatureManifest('current')).toMatchObject({
      arm: 'current',
      piBuiltInCompaction: true,
      contextRuntime: true,
      memorySystemPrefix: true,
      taskLedgerModelInjection: true,
      recallModelInjection: true,
      checkpointInjection: false,
      jspaceInjection: false,
    });
  });

  it('treats a controller with no requested boundaries as neutral', () => {
    expect(noOpNeutralityResult({
      control: { status: 'success', verifierScore: 1 },
      noOp: { status: 'success', verifierScore: 1, compactionEvents: [] },
    })).toEqual({
      neutral: true,
      reason: 'control and no-op verifier outcomes match without forced events',
    });
  });

  it('rejects a no-op result that changes verifier behavior or emits compaction', () => {
    expect(noOpNeutralityResult({
      control: { status: 'success', verifierScore: 1 },
      noOp: { status: 'success', verifierScore: 0, compactionEvents: [{ boundary: 'phase:2' }] },
    })).toEqual({
      neutral: false,
      reason: 'no-op run changed verifier behavior or emitted forced compaction events',
    });
  });

  it('writes the protected per-run evidence artifacts', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'jspace-artifacts-'));
    outputDirs.push(outputDir);

    await writeJspaceRunArtifacts(outputDir, {
      featureManifest: buildJspaceFeatureManifest('plain'),
      compactionEvents: [{ boundary: 'phase:2' }],
      usageEvents: [{ index: 1 }],
      toolTrace: [{ name: 'read' }],
      verifierResult: { correctnessScore: 1 },
      sandboxPath: '/tmp/probe-sandbox',
    });

    await expect(readFile(join(outputDir, 'feature-manifest.json'), 'utf8'))
      .resolves.toContain('"arm": "plain"');
    await expect(readFile(join(outputDir, 'compaction-events.json'), 'utf8'))
      .resolves.toContain('phase:2');
    await expect(readFile(join(outputDir, 'usage-events.json'), 'utf8'))
      .resolves.toContain('"index": 1');
    await expect(readFile(join(outputDir, 'tool-trace.json'), 'utf8'))
      .resolves.toContain('"name": "read"');
    await expect(readFile(join(outputDir, 'verifier-result.json'), 'utf8'))
      .resolves.toContain('"correctnessScore": 1');
    await expect(readFile(join(outputDir, 'run.json'), 'utf8'))
      .resolves.toContain('/tmp/probe-sandbox');
  });
});
