/** P1-E: distill → LessonWriter(findCausalPair) → main → harness promote. No knacks. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LessonsManager } from '../memory/lessons/manager.js';
import { distillRunEvents, parseJsonLines, type CandidateKnack } from './knack-distillation.js';
import type { VerificationKind } from './causal-pair.js';

export type DistillImportRun = {
  runId: string; taskId: string; instanceId: string; reward: 0 | 1;
  /** Task/issue instruction for fidelity-v2 symptom extraction. */
  taskInstruction?: string;
};

export async function importDistilledLessons(opts: {
  memoryDir: string; runs: DistillImportRun[]; harnessPromotedAt: string;
}): Promise<{
  distilled: CandidateKnack[];
  admitted: Array<{ lessonId: string; instanceId: string; runId: string; confidence: string }>;
  promoted: number;
  skipped: Array<{ instanceId: string; reason: string }>;
}> {
  LessonsManager.resetInstance();
  const mgr = LessonsManager.getInstance(opts.memoryDir);
  const distilled: CandidateKnack[] = [];
  const admitted: Array<{ lessonId: string; instanceId: string; runId: string; confidence: string }> = [];
  const skipped: Array<{ instanceId: string; reason: string }> = [];
  for (const run of opts.runs) {
    const dir = join(opts.memoryDir, 'runs', run.runId);
    const events = parseJsonLines(await readFile(join(dir, 'events.jsonl'), 'utf8'));
    const outcome = JSON.parse(await readFile(join(dir, 'outcome.json'), 'utf8')) as {
      finalSummary?: string; taskId?: string;
    };
    // Same verification index rule as distillResults: only harness-resolved.
    const verification: VerificationKind | undefined =
      run.reward === 1 ? 'verifier reward=1' : undefined;
    const [owner, rest] = run.instanceId.split('__');
    const candidate = distillRunEvents({
      events, evidenceTask: run.instanceId, verification, finalSummary: outcome.finalSummary,
      taskInstruction: run.taskInstruction,
      repo: owner && rest ? `${owner}/${rest.replace(/-\d+$/, '')}` : 'unknown',
    });
    if (!candidate) {
      skipped.push({ instanceId: run.instanceId,
        reason: verification ? 'distill_null_with_harness' : 'no_stream_or_harness_verification' });
      continue;
    }
    distilled.push(candidate);
    const row = await mgr.admitDistilled({
      events, verification, sessionRef: run.runId,
      lesson: `Symptom: ${candidate.symptom} Fix: ${candidate.fix_summary || '(not extracted)'}`,
      sourceSignalId: `distill:${candidate.id}`, taskId: outcome.taskId ?? run.taskId,
    });
    if (!row) { skipped.push({ instanceId: run.instanceId, reason: 'gate_rejected' }); continue; }
    admitted.push({ lessonId: row.id, instanceId: run.instanceId, runId: run.runId,
      confidence: row.confidence ?? 'candidate' });
  }
  let promoted = 0;
  for (const run of opts.runs.filter((r) => r.reward === 1)) {
    promoted += (await mgr.promoteCandidatesForRun({
      sessionRef: run.runId, reward: 1, promotedAt: opts.harnessPromotedAt,
    })).promoted;
  }
  return { distilled, admitted, promoted, skipped };
}
