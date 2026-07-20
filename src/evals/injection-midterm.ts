import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InjectionArm } from './injection-family-runner.js';

const ARMS: InjectionArm[] = ['A-L', 'A-K', 'B', 'C'];

export interface InjectionMidtermArmSummary {
  arm: InjectionArm;
  resolvedTask23: number;
  totalTokensTask23: number;
  escalationTriggersTask23: number;
  usedRecallRunsTask23: number;
}

export interface InjectionMidtermReport {
  familyId: string;
  complete: true;
  arms: InjectionMidtermArmSummary[];
  allFourArmsExtinct: boolean;
  replacementFamily: 'F-DJ-SELECT-MASK' | null;
  generatedAt: string;
}

export async function buildInjectionMidtermReport(options: {
  resultsDir: string;
  familyId: string;
  write?: boolean;
}): Promise<InjectionMidtermReport> {
  const arms: InjectionMidtermArmSummary[] = [];
  for (const arm of ARMS) {
    const batchDir = join(options.resultsDir, arm, options.familyId);
    const batch = await readJson(join(batchDir, 'batch.json')) as { runDirs?: unknown };
    if (!Array.isArray(batch.runDirs) || batch.runDirs.length !== 3) {
      throw new Error(`Midterm requires three completed runs for ${arm}/${options.familyId}`);
    }
    let resolvedTask23 = 0;
    let totalTokensTask23 = 0;
    let escalationTriggersTask23 = 0;
    let usedRecallRunsTask23 = 0;
    for (const runDir of batch.runDirs.slice(1)) {
      if (typeof runDir !== 'string') throw new Error(`Invalid run directory for ${arm}`);
      const [admission, trace] = await Promise.all([
        readJson(join(runDir, 'admission.json')),
        readJson(join(runDir, 'trace.json')),
      ]) as [
        { admission?: { resolved?: unknown } },
        { tokenUsage?: { totalTokens?: unknown }; failureEscalationEvents?: unknown[];
          recallAudit?: { used_recall_ids?: unknown[] } },
      ];
      if (typeof admission.admission?.resolved !== 'boolean') {
        throw new Error(`Missing harness admission for ${runDir}`);
      }
      resolvedTask23 += admission.admission.resolved ? 1 : 0;
      totalTokensTask23 += numberOrZero(trace.tokenUsage?.totalTokens);
      escalationTriggersTask23 += trace.failureEscalationEvents?.length ?? 0;
      usedRecallRunsTask23 += (trace.recallAudit?.used_recall_ids?.length ?? 0) > 0 ? 1 : 0;
    }
    arms.push({ arm, resolvedTask23, totalTokensTask23, escalationTriggersTask23, usedRecallRunsTask23 });
  }
  const allFourArmsExtinct = arms.every((arm) => arm.resolvedTask23 === 0);
  const report: InjectionMidtermReport = {
    familyId: options.familyId,
    complete: true,
    arms,
    allFourArmsExtinct,
    replacementFamily: allFourArmsExtinct && options.familyId === 'F-DJ-MIGRATION-REFERENCE'
      ? 'F-DJ-SELECT-MASK'
      : null,
    generatedAt: new Date().toISOString(),
  };
  if (options.write !== false) {
    await Promise.all([
      writeFile(join(options.resultsDir, `${options.familyId}-midterm.json`), JSON.stringify(report, null, 2)),
      writeFile(join(options.resultsDir, `${options.familyId}-midterm.md`), renderMidtermMarkdown(report)),
    ]);
  }
  return report;
}

export function renderMidtermMarkdown(report: InjectionMidtermReport): string {
  return [
    `# ${report.familyId} 中期报告`,
    '',
    '| 臂 | 第2+3题 resolved | tokens | 阶梯触发 | used_recall 非空 run |',
    '|---|---:|---:|---:|---:|',
    ...report.arms.map((arm) =>
      `| ${arm.arm} | ${arm.resolvedTask23} | ${arm.totalTokensTask23} | ${arm.escalationTriggersTask23} | ${arm.usedRecallRunsTask23} |`),
    '',
    `- 四臂全灭：${report.allFourArmsExtinct ? '是' : '否'}`,
    `- 替补族：${report.replacementFamily ?? '不触发'}`,
    '- 判读：方向性证据，非统计显著。',
    '',
  ].join('\n');
}

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
  catch (error) { throw new Error(`Missing or invalid midterm artifact: ${path}`, { cause: error }); }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
