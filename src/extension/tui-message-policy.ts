export function shouldShowAgentErrorMessage(errorMessage: string | null | undefined): boolean {
  const text = errorMessage?.trim();
  if (!text) return false;
  return !/^request was aborted\.?$/iu.test(text);
}

export function formatPlanningFailureStatus(
  reason: 'missing-task-start' | 'error',
  detail?: unknown,
): string {
  if (reason === 'missing-task-start') return '规划失败：未输出 TASK_START';
  const message = detail instanceof Error ? detail.message : String(detail ?? '').trim();
  return message ? `规划失败：${message}` : '规划失败';
}
