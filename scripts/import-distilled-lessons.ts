/**
 * CLI: distill memory runs → LessonWriter → main library → harness promote.
 *
 * Usage:
 *   npx tsx scripts/import-distilled-lessons.ts \
 *     --memory-dir evals/results/swebench/.../memory-... \
 *     --harness-report evals/distillation/p1-phase2b-zenmux-harness-report.json \
 *     --output evals/distillation/p1-e-supply-report.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { importDistilledLessons } from '../src/evals/import-distilled-lessons.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const memoryDir = resolve(must(readOption(args, '--memory-dir'), '--memory-dir'));
  const harnessPath = resolve(must(readOption(args, '--harness-report'), '--harness-report'));
  const outputPath = resolve(
    readOption(args, '--output') ?? 'evals/distillation/p1-e-supply-report.json',
  );

  const harness = JSON.parse(await readFile(harnessPath, 'utf8')) as {
    completedAt?: string;
    perInstance: Array<{
      instanceId: string;
      runId: string;
      harness: string;
    }>;
  };

  const runs = harness.perInstance.map((row) => ({
    runId: row.runId,
    taskId: row.runId.replace(/^run_/, 'task_'),
    instanceId: row.instanceId,
    reward: (row.harness === 'resolved' ? 1 : 0) as 0 | 1,
  }));

  const result = await importDistilledLessons({
    memoryDir,
    runs,
    harnessPromotedAt: harness.completedAt ?? new Date().toISOString(),
  });

  const { LessonsManager } = await import('../src/memory/lessons/manager.js');
  LessonsManager.resetInstance();
  const mgr = LessonsManager.getInstance(memoryDir);
  const main = await mgr.getAll();
  const verified = main.filter((l) => l.confidence === 'verified').length;
  const candidate = main.filter((l) => l.confidence === 'candidate').length;

  const report = {
    supplyPath: 'distill(events) → LessonWriter.findCausalPair gate → lessons.jsonl → harness promote',
    ...result,
    mainLibrary: {
      total: main.length,
      verified,
      candidate,
      verifiedRatio: main.length ? verified / main.length : null,
      lessons: main.map((l) => ({
        id: l.id,
        confidence: l.confidence,
        promotedAt: l.promotedAt,
        sessionRef: l.provenance.sessionRef,
        lesson: l.lesson,
      })),
    },
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    distilled: result.distilled.length,
    admitted: result.admitted.length,
    promoted: result.promoted,
    skipped: result.skipped,
    verifiedRatio: report.mainLibrary.verifiedRatio,
  }, null, 2));
}

function readOption(argsList: string[], name: string): string | undefined {
  const index = argsList.indexOf(name);
  return index >= 0 ? argsList[index + 1] : undefined;
}

function must(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
