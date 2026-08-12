export function shouldShowAgentErrorMessage(errorMessage: string | null | undefined): boolean {
  const text = errorMessage?.trim();
  if (!text) return false;
  return !/^request was aborted\.?$/iu.test(text);
}

/**
 * Pi coding-agent auth errors mention `/login` (its own CLI).
 * Student Agent uses `/setting` / `/provider` instead.
 */
export function rewriteProviderAuthHints(errorMessage: string): string {
  return errorMessage
    .replace(
      /Use\s+\/login\s+to\s+log\s+into\s+a\s+provider\s+via\s+OAuth\s+or\s+API\s+key\.?/giu,
      '请使用 /setting 配置 Provider 与 API Key（本程序没有 /login）。',
    )
    .replace(/\/login\b/gu, '/setting');
}

export function formatAgentErrorForDisplay(errorMessage: string | null | undefined): string | null {
  if (!shouldShowAgentErrorMessage(errorMessage)) return null;
  return rewriteProviderAuthHints(errorMessage!.trim());
}

export function formatPlanningFailureStatus(
  reason: 'missing-task-start' | 'error',
  detail?: unknown,
): string {
  if (reason === 'missing-task-start') return '规划失败：未输出 TASK_START';
  const message = detail instanceof Error ? detail.message : String(detail ?? '').trim();
  return message ? `规划失败：${message}` : '规划失败';
}
