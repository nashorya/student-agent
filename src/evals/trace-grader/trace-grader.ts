import { readEventsJsonl } from './events-jsonl.js';
import { normalizeTraceEvent, type NormalizedTraceEvent } from './trace-event.js';
import type {
  TraceGradeCheck,
  TraceGradeResult,
  TraceGradeStatus,
  TraceGraderConfig,
  TraceGradeSummary,
} from './types.js';

export const DEFAULT_TRACE_GRADER_CONFIG: Required<TraceGraderConfig> = {
  requireToolCall: true,
  requireFileChange: true,
  requireValidationCommand: true,

  minToolCalls: 1,
  minFileWrites: 1,

  validationCommandPatterns: [
    'test',
    'vitest',
    'jest',
    'tsc',
    'lint',
    'typecheck',
    'npm test',
    'pnpm test',
    'yarn test',
  ],

  writeToolNames: [
    'write',
    'edit',
    'apply_patch',
    'patch',
    'smart_edit',
    'replace',
    'create_file',
    'delete_file',
  ],

  readToolNames: [
    'read',
    'read_file',
    'read_range',
    'read_many',
    'grep',
    'search',
    'list',
  ],

  allowWarnings: false,
};

const FILE_CHANGE_PATTERNS = [
  'diff',
  'patch',
  'modified',
  'created',
  'deleted',
  'files changed',
  'apply_patch',
];

const SUCCESS_CLAIM_PATTERNS = [
  '完成',
  'done',
  'success',
  'passed',
  'all tests pass',
  'tsc clean',
  'tests green',
];

export function gradeTraceEvents(
  events: unknown[],
  config: TraceGraderConfig = {},
): TraceGradeResult {
  const resolved = { ...DEFAULT_TRACE_GRADER_CONFIG, ...config };
  const normalized = events.map(normalizeTraceEvent);
  const toolEvents = normalized.filter(isToolCallEvent);
  const readToolEvents = toolEvents.filter((event) => matchesAny(event.toolName, resolved.readToolNames));
  const writeToolEvents = toolEvents.filter((event) => matchesAny(event.toolName, resolved.writeToolNames));
  const validationEvents = normalized.filter((event) => isValidationEvent(event, resolved.validationCommandPatterns));
  const touchedFiles = unique(normalized.flatMap((event) => event.filePath ? [event.filePath] : []));
  const hasFileChangeSignal = writeToolEvents.length > 0
    || touchedFiles.length > 0
    || normalized.some(hasFileChangeText);
  const hasFinalSuccessClaim = normalized.some(hasSuccessClaim);

  const summary: TraceGradeSummary = {
    toolCallCount: toolEvents.length,
    readToolCallCount: readToolEvents.length,
    writeToolCallCount: writeToolEvents.length,
    validationCommandCount: validationEvents.length,
    touchedFiles,
    hasFileChangeSignal,
    hasFinalSuccessClaim,
  };
  const checks = buildChecks(summary, resolved);

  return {
    status: overallStatus(checks),
    summary,
    checks,
  };
}

export async function gradeEventsJsonl(
  eventsPath: string,
  config?: TraceGraderConfig,
): Promise<TraceGradeResult> {
  return gradeTraceEvents(await readEventsJsonl(eventsPath), config);
}

function buildChecks(
  summary: TraceGradeSummary,
  config: Required<TraceGraderConfig>,
): TraceGradeCheck[] {
  const checks: TraceGradeCheck[] = [];

  const toolCallsPass = !config.requireToolCall || summary.toolCallCount >= config.minToolCalls;
  checks.push({
    id: 'tool_calls_present',
    status: toolCallsPass ? 'pass' : 'fail',
    message: toolCallsPass
      ? `Trace contains ${summary.toolCallCount} tool call(s).`
      : `Trace requires at least ${config.minToolCalls} tool call(s), found ${summary.toolCallCount}.`,
    evidence: [`toolCallCount=${summary.toolCallCount}`],
  });

  const fileChangesPass = !config.requireFileChange
    || summary.writeToolCallCount >= config.minFileWrites
    || summary.hasFileChangeSignal;
  checks.push({
    id: 'file_changes_present',
    status: fileChangesPass ? 'pass' : 'fail',
    message: fileChangesPass
      ? 'Trace contains file change evidence.'
      : 'Trace does not contain required file change evidence.',
    evidence: [
      `writeToolCallCount=${summary.writeToolCallCount}`,
      `hasFileChangeSignal=${summary.hasFileChangeSignal}`,
      `touchedFiles=${summary.touchedFiles.join(',') || 'none'}`,
    ],
  });

  const validationPass = !config.requireValidationCommand || summary.validationCommandCount > 0;
  const validationStatus: TraceGradeStatus = validationPass
    ? 'pass'
    : config.allowWarnings ? 'warning' : 'fail';
  checks.push({
    id: 'validation_present',
    status: validationStatus,
    message: validationPass
      ? `Trace contains ${summary.validationCommandCount} validation command(s).`
      : 'Trace does not contain a validation command.',
    evidence: [`validationCommandCount=${summary.validationCommandCount}`],
  });

  const fakeSuccessWithoutTools = summary.hasFinalSuccessClaim && summary.toolCallCount === 0;
  checks.push({
    id: 'fake_success_without_tools',
    status: fakeSuccessWithoutTools ? 'fail' : 'pass',
    message: fakeSuccessWithoutTools
      ? 'Trace contains success claim but no tool calls.'
      : 'Trace does not contain success claims without tool evidence.',
    evidence: [`hasFinalSuccessClaim=${summary.hasFinalSuccessClaim}`, `toolCallCount=${summary.toolCallCount}`],
  });

  const fakeSuccessWithoutValidation = summary.hasFinalSuccessClaim
    && config.requireValidationCommand
    && summary.validationCommandCount === 0;
  checks.push({
    id: 'fake_success_without_validation',
    status: fakeSuccessWithoutValidation
      ? config.allowWarnings ? 'warning' : 'fail'
      : 'pass',
    message: fakeSuccessWithoutValidation
      ? 'Trace contains success claim but no validation command.'
      : 'Trace does not contain success claims without validation evidence.',
    evidence: [
      `hasFinalSuccessClaim=${summary.hasFinalSuccessClaim}`,
      `validationCommandCount=${summary.validationCommandCount}`,
    ],
  });

  return checks;
}

function isToolCallEvent(event: NormalizedTraceEvent): boolean {
  const type = event.type.toLowerCase();
  return Boolean(event.toolName)
    || type.includes('tool')
    || type.includes('tool_call')
    || type.includes('tool_result');
}

function isValidationEvent(
  event: NormalizedTraceEvent,
  patterns: string[],
): boolean {
  return [
    event.command,
    event.message,
    event.content,
  ].filter((value): value is string => Boolean(value))
    .some((text) => matchesAny(text, patterns));
}

function hasFileChangeText(event: NormalizedTraceEvent): boolean {
  return [
    event.type,
    event.message,
    event.content,
  ].filter(Boolean)
    .some((text) => matchesAny(text, FILE_CHANGE_PATTERNS));
}

function hasSuccessClaim(event: NormalizedTraceEvent): boolean {
  return [
    event.message,
    event.content,
  ].filter(Boolean)
    .some((text) => matchesAny(text, SUCCESS_CLAIM_PATTERNS));
}

function matchesAny(value: string | undefined, patterns: string[]): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

function overallStatus(checks: TraceGradeCheck[]): TraceGradeStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warning')) return 'warning';
  return 'pass';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
