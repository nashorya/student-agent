import type { AttemptRecord, ErrorCategory } from './types.js';
import { t, DIAGNOSIS_L10N_TABLE } from '../i18n/messages.js';

export interface DiagnosticInput {
  taskDescription: string;
  attempts: AttemptRecord[];
  errorCategory: ErrorCategory;
  errorSubtype: string;
  rawError: string;
}

interface DiagnosisEntry {
  inferReason: string;
  questions: [string, string];
}

const BORDER = '='.repeat(39);

function lookupEntry(category: ErrorCategory, subtype: string): DiagnosisEntry {
  const byLocaleCategory = DIAGNOSIS_L10N_TABLE[category];
  if (byLocaleCategory) {
    const entry = byLocaleCategory[subtype] ?? byLocaleCategory['unknown'];
    if (entry) {
      return {
        inferReason: entry.inferReason['zh-CN'] ?? entry.inferReason['en-US'] ?? `Unknown error (${category}/${subtype})`,
        questions: [
          entry.questions[0]['zh-CN'] ?? entry.questions[0]['en-US'] ?? 'Can you provide more context?',
          entry.questions[1]['zh-CN'] ?? entry.questions[1]['en-US'] ?? 'Can you try a simpler task?',
        ],
      };
    }
  }
  return {
    inferReason: t('diag.unknown_reason', { category, subtype }),
    questions: [
      '能否提供更多操作上下文？', // No i18n needed for fallback
      '是否可以尝试简化任务再重试？',
    ] as [string, string],
  };
}

function formatAttempts(attempts: AttemptRecord[]): string {
  if (attempts.length === 0) return t('diag.no_attempts');
  return attempts
    .map((a, i) => ` [${i + 1}] ${a.strategy} → ${a.reason ?? a.result}`)
    .join('\n');
}

export function renderDiagnosticReport(input: DiagnosticInput): string {
  const { taskDescription, attempts, errorCategory, errorSubtype } = input;
  const entry = lookupEntry(errorCategory, errorSubtype);

  return [
    BORDER,
    '',
    ` ${t('diag.warn_banner')}`,
    '',
    ` ${t('diag.task_label')}${taskDescription}`,
    '',
    ` ${t('diag.tried')}`,
    formatAttempts(attempts),
    '',
    ` ${t('diag.suspected_reason')}：${entry.inferReason}`,
    '',
    ` ${t('diag.please_ask')}`,
    ` 1. ${entry.questions[0]}`,
    ` 2. ${entry.questions[1]}`,
    BORDER,
  ].join('\n');
}

export function writeDiagnosticReport(
  input: DiagnosticInput,
  out: NodeJS.WritableStream = process.stdout,
): void {
  out.write(renderDiagnosticReport(input) + '\n');
}
