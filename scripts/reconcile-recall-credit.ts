import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  loadSweBenchRecallReconciliationInput,
  reconcileSweBenchRecallCredits,
} from '../src/evals/recall-credit-reconciler.js';

interface Options {
  recordsPath: string;
  harnessPath: string;
  memoryDir: string;
  outputPath: string;
  dryRun: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const loaded = await loadSweBenchRecallReconciliationInput(options);
  const report = await reconcileSweBenchRecallCredits({
    ...loaded,
    memoryDir: options.memoryDir,
    dryRun: options.dryRun,
  });
  const output = {
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    recordsPath: options.recordsPath,
    harnessPath: options.harnessPath,
    memoryDir: options.memoryDir,
    ...report,
  };
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, outputPath: options.outputPath, counts: report.counts }, null, 2));
}

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--dry-run') { dryRun = true; continue; }
    if (args[index]?.startsWith('--') && args[index + 1]) values.set(args[index], args[++index]);
  }
  const recordsPath = values.get('--records');
  const harnessPath = values.get('--harness');
  const memoryDir = values.get('--memory-dir');
  if (!recordsPath || !harnessPath || !memoryDir) {
    throw new Error('Usage: --records <records.json> --harness <harness-report.json> --memory-dir <dir> [--output <path>] [--dry-run]');
  }
  return {
    recordsPath: resolve(recordsPath),
    harnessPath: resolve(harnessPath),
    memoryDir: resolve(memoryDir),
    outputPath: resolve(values.get('--output') ?? 'recall-audit-report.json'),
    dryRun,
  };
}

await main();
