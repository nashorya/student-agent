import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPinnedScoringCommand } from '../../../scripts/eval-injection-score.js';

describe('injection experiment scoring', () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('passes only the pinned local dataset snapshot to the official harness', async () => {
    const root = await fixture();
    const command = await buildPinnedScoringCommand({
      pythonCommand: '/tmp/swebench-harness-venv/bin/python',
      manifestPath: join(root, 'snapshot.json'),
      predictionsPath: join(root, 'predictions.jsonl'),
      instanceIds: ['astropy__astropy-12907'],
      runId: 'p1prom-old-12907-smoke',
      preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'),
    }, async () => 'b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627');

    expect(command.args).toContain(join(root, 'dataset'));
    expect(command.args).toContain('astropy__astropy-12907');
    expect(command.args).toContain('p1prom-old-12907-smoke');
  });

  it('rejects a snapshot whose decoded Arrow hash differs from the preregistration', async () => {
    const root = await fixture('wrong-sha');
    await expect(buildPinnedScoringCommand({
      pythonCommand: 'python3',
      manifestPath: join(root, 'snapshot.json'),
      predictionsPath: join(root, 'predictions.jsonl'),
      instanceIds: ['astropy__astropy-12907'],
      runId: 'smoke',
      preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'),
    })).rejects.toThrow('Arrow SHA-256');
  });

  it('rejects a manifest whose source Arrow file hashes differently', async () => {
    const root = await fixture();
    await expect(buildPinnedScoringCommand({
      pythonCommand: 'python3',
      manifestPath: join(root, 'snapshot.json'),
      predictionsPath: join(root, 'predictions.jsonl'),
      instanceIds: ['astropy__astropy-12907'],
      runId: 'smoke',
      preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'),
    }, async () => 'wrong-sha')).rejects.toThrow('source Arrow file');
  });

  it('rejects a saved dataset whose consumed Arrow differs from the frozen snapshot', async () => {
    const root = await fixture();
    await expect(buildPinnedScoringCommand({
      pythonCommand: 'python3',
      manifestPath: join(root, 'snapshot.json'),
      predictionsPath: join(root, 'predictions.jsonl'),
      instanceIds: ['astropy__astropy-12907'],
      runId: 'smoke',
      preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'),
    }, async (path) => path.endsWith('source.arrow')
      ? 'b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627'
      : 'tampered-dataset')).rejects.toThrow('saved dataset Arrow');
  });

  it('rejects a remote dataset name instead of a local saved snapshot', async () => {
    const root = await fixture();
    const manifestPath = join(root, 'snapshot.json');
    const manifest = JSON.parse(await import('node:fs/promises').then(({ readFile }) =>
      readFile(manifestPath, 'utf8')));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, datasetPath: 'SWE-bench/SWE-bench_Lite' }));
    await expect(buildPinnedScoringCommand({
      pythonCommand: 'python3',
      manifestPath,
      predictionsPath: join(root, 'predictions.jsonl'),
      instanceIds: ['astropy__astropy-12907'],
      runId: 'smoke',
      preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'),
    }, async () => 'b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627'))
      .rejects.toThrow('local saved dataset');
  });

  async function fixture(arrowSha256 = 'b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627') {
    const root = await mkdtemp(join(tmpdir(), 'injection-score-'));
    roots.push(root);
    await mkdir(join(root, 'dataset', 'test'), { recursive: true });
    await writeFile(join(root, 'dataset', 'test', 'dataset_info.json'), '{}');
    await writeFile(join(root, 'dataset', 'test', 'state.json'), JSON.stringify({
      _data_files: [{ filename: 'data-00000-of-00001.arrow' }],
    }));
    await writeFile(join(root, 'dataset', 'test', 'data-00000-of-00001.arrow'), 'saved Arrow fixture');
    await writeFile(join(root, 'snapshot.json'), JSON.stringify({
      datasetPath: join(root, 'dataset'),
      datasetCommit: '69611d31007e1c6731db8bd5b5c3f2d33f5bab6e',
      arrowSha256,
      sourceArrowPath: join(root, 'source.arrow'),
    }));
    await writeFile(join(root, 'source.arrow'), 'decoded Arrow fixture');
    await writeFile(join(root, 'predictions.jsonl'), JSON.stringify({
      instance_id: 'astropy__astropy-12907',
      model_name_or_path: 'old-p1prom',
      model_patch: 'diff --git a/a.py b/a.py\n',
    }));
    return root;
  }
});
