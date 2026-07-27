/**
 * CLI: offline run-level distillation → candidate-knacks.json. AUDIT ONLY.
 * The live knack supply chain runs online (lessons → knacks); this stays as the
 * fidelity comparison baseline and writes no library.
 */
import { resolve } from 'node:path';
import { distillResults } from '../src/evals/knack-distillation.js';

const args = process.argv.slice(2);
const resultsDir = resolve(readOption(args, '--results-dir') ?? 'evals/results');
const outputPath = resolve(
  readOption(args, '--output') ?? 'evals/distillation/candidate-knacks.json',
);

const candidates = await distillResults(resultsDir, outputPath);
console.log(JSON.stringify({
  resultsDir,
  outputPath,
  candidateCount: candidates.length,
}, null, 2));

function readOption(argsList: string[], name: string): string | undefined {
  const index = argsList.indexOf(name);
  return index >= 0 ? argsList[index + 1] : undefined;
}
