import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INJECTION_ARMS, type InjectionArm } from './injection-family-runner.js';

/**
 * v0.4 readout. Task 2 is the only position where every arm starts from an
 * identical memory pool (the shared family seed), so it is the sole primary
 * channel. Task 3 is conditional on the arm's own task-2 outcome and is
 * reported separately. Composite descriptors are always reported but never
 * act as an alternative route to supporting H1.
 */
export type PairedOutcome = 'arm_only' | 'comparator_only' | 'tie_resolved' | 'tie_unresolved';

export interface InjectionRunMetrics {
  resolved: boolean;
  totalTokens: number;
  escalationTriggers: number;
  usedRecall: boolean;
}

export interface InjectionArmReadout {
  arm: InjectionArm;
  task2: InjectionRunMetrics;
  task3: InjectionRunMetrics;
}

export interface PairedComparison {
  arm: InjectionArm;
  comparator: InjectionArm;
  outcome: PairedOutcome;
}

export interface InjectionFamilyReadout {
  familyId: string;
  seedResolved: boolean;
  usable: boolean;
  unusableReason: string | null;
  arms: InjectionArmReadout[] | null;
  /** H1: A-L vs B on task 2. */
  primary: PairedComparison | null;
  /** H1-K: A-K vs B on task 2. */
  secondary: PairedComparison | null;
  generatedAt: string;
}

export interface SignCount {
  armOnly: number;
  comparatorOnly: number;
  tieResolved: number;
  tieUnresolved: number;
}

export interface InjectionReadout {
  families: InjectionFamilyReadout[];
  usableFamilies: number;
  unusableFamilies: number;
  primarySignCount: SignCount;
  secondarySignCount: SignCount;
  /** Pre-declared: at most three paired points, so no inference is made. */
  statisticalClaim: 'none';
  generatedAt: string;
}

const SEED_UNRESOLVED = 'seed_unresolved_no_injection_contrast';

export async function buildInjectionFamilyReadout(options: {
  resultsDir: string;
  familyId: string;
  write?: boolean;
}): Promise<InjectionFamilyReadout> {
  const seed = await readJson(join(options.resultsDir, 'seed', options.familyId, 'batch.json')) as { resolved?: unknown };
  const seedResolved = seed.resolved === true;
  const base = {
    familyId: options.familyId,
    seedResolved,
    generatedAt: new Date().toISOString(),
  };

  let report: InjectionFamilyReadout;
  if (!seedResolved) {
    // Not evidence against injection: the family simply never produced a contrast.
    report = { ...base, usable: false, unusableReason: SEED_UNRESOLVED, arms: null, primary: null, secondary: null };
  } else {
    const arms: InjectionArmReadout[] = [];
    for (const arm of INJECTION_ARMS) {
      const batchDir = join(options.resultsDir, arm, options.familyId);
      const batch = await readJson(join(batchDir, 'batch.json')) as { runDirs?: unknown };
      if (!Array.isArray(batch.runDirs) || batch.runDirs.length !== 2) {
        throw new Error(`Readout requires two completed arm runs for ${arm}/${options.familyId}`);
      }
      const [task2, task3] = await Promise.all(batch.runDirs.map((runDir) => {
        if (typeof runDir !== 'string') throw new Error(`Invalid run directory for ${arm}`);
        return readRunMetrics(runDir, arm);
      }));
      arms.push({ arm, task2: task2!, task3: task3! });
    }
    report = {
      ...base,
      usable: true,
      unusableReason: null,
      arms,
      primary: compare(arms, 'A-L', 'B'),
      secondary: compare(arms, 'A-K', 'B'),
    };
  }

  if (options.write !== false) {
    await Promise.all([
      writeFile(join(options.resultsDir, `${options.familyId}-readout.json`), JSON.stringify(report, null, 2)),
      writeFile(join(options.resultsDir, `${options.familyId}-readout.md`), renderFamilyMarkdown(report)),
    ]);
  }
  return report;
}

export async function buildInjectionReadout(options: {
  resultsDir: string;
  familyIds: string[];
  write?: boolean;
}): Promise<InjectionReadout> {
  const families: InjectionFamilyReadout[] = [];
  for (const familyId of options.familyIds) {
    families.push(await buildInjectionFamilyReadout({
      resultsDir: options.resultsDir, familyId, write: false,
    }));
  }
  const usable = families.filter((family) => family.usable);
  const report: InjectionReadout = {
    families,
    usableFamilies: usable.length,
    unusableFamilies: families.length - usable.length,
    primarySignCount: countSigns(usable.map((family) => family.primary)),
    secondarySignCount: countSigns(usable.map((family) => family.secondary)),
    statisticalClaim: 'none',
    generatedAt: new Date().toISOString(),
  };
  if (options.write !== false) {
    await Promise.all([
      writeFile(join(options.resultsDir, 'injection-readout.json'), JSON.stringify(report, null, 2)),
      writeFile(join(options.resultsDir, 'injection-readout.md'), renderReadoutMarkdown(report)),
    ]);
  }
  return report;
}

function compare(arms: InjectionArmReadout[], armId: InjectionArm, comparatorId: InjectionArm): PairedComparison {
  const arm = arms.find((item) => item.arm === armId);
  const comparator = arms.find((item) => item.arm === comparatorId);
  if (!arm || !comparator) throw new Error(`Missing ${armId} or ${comparatorId} for the paired comparison`);
  return { arm: armId, comparator: comparatorId, outcome: outcomeOf(arm.task2.resolved, comparator.task2.resolved) };
}

function outcomeOf(armResolved: boolean, comparatorResolved: boolean): PairedOutcome {
  if (armResolved && comparatorResolved) return 'tie_resolved';
  if (!armResolved && !comparatorResolved) return 'tie_unresolved';
  return armResolved ? 'arm_only' : 'comparator_only';
}

function countSigns(comparisons: Array<PairedComparison | null>): SignCount {
  const counts: SignCount = { armOnly: 0, comparatorOnly: 0, tieResolved: 0, tieUnresolved: 0 };
  for (const comparison of comparisons) {
    if (!comparison) continue;
    if (comparison.outcome === 'arm_only') counts.armOnly += 1;
    else if (comparison.outcome === 'comparator_only') counts.comparatorOnly += 1;
    else if (comparison.outcome === 'tie_resolved') counts.tieResolved += 1;
    else counts.tieUnresolved += 1;
  }
  return counts;
}

async function readRunMetrics(runDir: string, arm: InjectionArm): Promise<InjectionRunMetrics> {
  const [admission, trace] = await Promise.all([
    readJson(join(runDir, 'admission.json')),
    readJson(join(runDir, 'trace.json')),
  ]) as [
    { admission?: { resolved?: unknown } },
    { tokenUsage?: { totalTokens?: unknown }; failureEscalationEvents?: unknown[];
      recallAudit?: { used_recall_ids?: unknown[] } },
  ];
  if (typeof admission.admission?.resolved !== 'boolean') {
    throw new Error(`Missing harness admission for ${runDir} (${arm})`);
  }
  return {
    resolved: admission.admission.resolved,
    totalTokens: numberOrZero(trace.tokenUsage?.totalTokens),
    escalationTriggers: trace.failureEscalationEvents?.length ?? 0,
    usedRecall: (trace.recallAudit?.used_recall_ids?.length ?? 0) > 0,
  };
}

export function renderFamilyMarkdown(report: InjectionFamilyReadout): string {
  if (!report.usable || !report.arms) {
    return [
      `# ${report.familyId} 判读`,
      '',
      `- 种子题 resolved：否`,
      `- 该族状态：**对主分析作废**（${report.unusableReason}）`,
      '- 注意：这不构成「注入无效」的证据，只表示该族未能产生注入对照。',
      '',
    ].join('\n');
  }
  return [
    `# ${report.familyId} 判读`,
    '',
    '- 种子题 resolved：是（三臂起始记忆池相同）',
    '',
    '## 第 2 题（主判读位置）',
    '',
    '| 臂 | resolved | tokens | 阶梯触发 | used_recall |',
    '|---|---|---:|---:|---|',
    ...report.arms.map((arm) =>
      `| ${arm.arm} | ${arm.task2.resolved ? '是' : '否'} | ${arm.task2.totalTokens} `
      + `| ${arm.task2.escalationTriggers} | ${arm.task2.usedRecall ? '是' : '否'} |`),
    '',
    `- H1（A-L vs B）：${report.primary?.outcome}`,
    `- H1-K（A-K vs B）：${report.secondary?.outcome}`,
    '',
    '## 第 3 题（条件性，不进主判读）',
    '',
    '| 臂 | resolved | tokens | 阶梯触发 | used_recall |',
    '|---|---|---:|---:|---|',
    ...report.arms.map((arm) =>
      `| ${arm.arm} | ${arm.task3.resolved ? '是' : '否'} | ${arm.task3.totalTokens} `
      + `| ${arm.task3.escalationTriggers} | ${arm.task3.usedRecall ? '是' : '否'} |`),
    '',
    '- 第 3 题的记忆池取决于该臂自身第 2 题结果，只作探索性描述。',
    '- 复合量恒报告，但不构成 H1/H1-K 的替代判读通道。',
    '',
  ].join('\n');
}

export function renderReadoutMarkdown(report: InjectionReadout): string {
  return [
    '# 注入效果实验 v0.4 判读',
    '',
    `- 可用族：${report.usableFamilies} / ${report.families.length}（不可用 ${report.unusableFamilies}）`,
    '',
    '| 族 | 种子 resolved | 可用 | H1(A-L vs B) | H1-K(A-K vs B) |',
    '|---|---|---|---|---|',
    ...report.families.map((family) =>
      `| ${family.familyId} | ${family.seedResolved ? '是' : '否'} | ${family.usable ? '是' : '否'} `
      + `| ${family.primary?.outcome ?? '—'} | ${family.secondary?.outcome ?? '—'} |`),
    '',
    `- H1 跨族符号计数：A-L 独过 ${report.primarySignCount.armOnly}，B 独过 ${report.primarySignCount.comparatorOnly}，`
    + `双过 ${report.primarySignCount.tieResolved}，双未过 ${report.primarySignCount.tieUnresolved}`,
    `- H1-K 跨族符号计数：A-K 独过 ${report.secondarySignCount.armOnly}，B 独过 ${report.secondarySignCount.comparatorOnly}，`
    + `双过 ${report.secondarySignCount.tieResolved}，双未过 ${report.secondarySignCount.tieUnresolved}`,
    '',
    '- 统计推断：**不作**。最多 3 个配对点，只报告原样计数，不换算为率或百分比。',
    '- 种子未过的族记为「无法产生注入对照」，不得解释为注入无效。',
    '',
  ].join('\n');
}

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
  catch (error) { throw new Error(`Missing or invalid readout artifact: ${path}`, { cause: error }); }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
