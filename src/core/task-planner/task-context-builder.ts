import type { Task } from '../../memory/tasks/types.js';

export function buildTaskContextPrefix(task: Task | null, ctx7Docs?: string): string {
  if (!task) return '';

  const phase = task.phases[task.active_phase_index];
  if (!phase) return '';

  const lines: string[] = [
    `[当前任务] ${task.name}`,
    `[当前 Phase] Phase ${task.active_phase_index + 1}/${task.phases.length}：${phase.description}`,
  ];

  if (phase.retry_count > 0) {
    lines.push(`[注意] 此 Phase 已重试 ${phase.retry_count} 次，用户反馈：`);
    phase.feedbacks.forEach((f) => lines.push(`  - ${f}`));
  }

  if (ctx7Docs) {
    lines.push('[参考文档]');
    lines.push(ctx7Docs);
  }

  return lines.join('\n') + '\n\n';
}
