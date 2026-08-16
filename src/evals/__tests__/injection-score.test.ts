import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPinnedScoringCommand,
  locateHarnessReports,
  runHarnessProcess,
} from '../../../scripts/eval-injection-score.js';

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

describe('harness process capture', () => {
  it('writes command/stdout/stderr even when the child exits 1', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'harness-capture-'));
    const result = await runHarnessProcess({
      command: process.execPath,
      args: ['-e', 'console.log("out-line"); console.error("err-line"); process.exit(1)'],
    }, cwd);
    expect(result.exitCode).toBe(1);
    expect(await readFile(result.stdoutPath, 'utf8')).toContain('out-line');
    expect(await readFile(result.stderrPath, 'utf8')).toContain('err-line');
    expect(JSON.parse(await readFile(result.commandPath, 'utf8')).command).toBe(process.execPath);
  });

  it('does not add --namespace unless explicitly requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'injection-score-ns-'));
    await mkdir(join(root, 'dataset', 'test'), { recursive: true });
    await writeFile(join(root, 'dataset', 'test', 'dataset_info.json'), '{}');
    await writeFile(join(root, 'dataset', 'test', 'state.json'), JSON.stringify({
      _data_files: [{ filename: 'data-00000-of-00001.arrow' }],
    }));
    await writeFile(join(root, 'dataset', 'test', 'data-00000-of-00001.arrow'), 'saved Arrow fixture');
    await writeFile(join(root, 'snapshot.json'), JSON.stringify({
      datasetPath: join(root, 'dataset'),
      datasetCommit: '69611d31007e1c6731db8bd5b5c3f2d33f5bab6e',
      arrowSha256: 'b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627',
      sourceArrowPath: join(root, 'source.arrow'),
    }));
    await writeFile(join(root, 'source.arrow'), 'decoded Arrow fixture');
    await writeFile(join(root, 'predictions.jsonl'), JSON.stringify({
      instance_id: 'astropy__astropy-12907',
      model_name_or_path: 'old-p1prom',
      model_patch: 'diff --git a/a.py b/a.py\n',
    }));
    const hash = async () => 'b77fa3036c06219715a35e8088fee13b0b87bc957052546c3270caf38a325627';
    const plain = await buildPinnedScoringCommand({
      pythonCommand: 'python3',
      manifestPath: join(root, 'snapshot.json'),
      predictionsPath: join(root, 'predictions.jsonl'),
      instanceIds: ['astropy__astropy-12907'],
      runId: 'smoke',
      preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'),
    }, hash);
    expect(plain.args).not.toContain('--namespace');
    const forced = await buildPinnedScoringCommand({
      pythonCommand: 'python3',
      manifestPath: join(root, 'snapshot.json'),
      predictionsPath: join(root, 'predictions.jsonl'),
      instanceIds: ['astropy__astropy-12907'],
      runId: 'smoke',
      preregPath: resolve('docs/proposals/injection-effect-experiment-prereg-v0.md'),
      namespace: 'none',
    }, hash);
    expect(forced.args.slice(forced.args.indexOf('--namespace'), forced.args.indexOf('--namespace') + 2))
      .toEqual(['--namespace', 'none']);
  });

  it('finds reports at the canonical path and via run_id glob', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'harness-reports-'));
    const runId = 'bscan-django__django-10914';
    const modelDir = 'glm-5.3';
    const instanceId = 'django__django-10914';
    await mkdir(join(cwd, 'logs', 'run_evaluation', runId, modelDir, instanceId), { recursive: true });
    await writeFile(join(cwd, `${modelDir}.${runId}.json`), '{"resolved_ids":[]}');
    await writeFile(join(cwd, 'logs', 'run_evaluation', runId, modelDir, instanceId, 'report.json'), '{}');
    await expect(locateHarnessReports({ cwd, runId, modelDir, instanceId })).resolves.toEqual({
      summaryPath: join(cwd, `${modelDir}.${runId}.json`),
      instanceReportPath: join(cwd, 'logs', 'run_evaluation', runId, modelDir, instanceId, 'report.json'),
    });
    const alt = await mkdtemp(join(tmpdir(), 'harness-reports-alt-'));
    await mkdir(join(alt, 'logs', 'run_evaluation', runId, 'other-model', instanceId), { recursive: true });
    await writeFile(join(alt, `other-model.${runId}.json`), '{}');
    await writeFile(join(alt, 'logs', 'run_evaluation', runId, 'other-model', instanceId, 'report.json'), '{}');
    const found = await locateHarnessReports({ cwd: alt, runId, modelDir, instanceId });
    expect(found?.summaryPath).toBe(join(alt, `other-model.${runId}.json`));
    expect(found?.instanceReportPath).toContain('other-model');
  });
});
