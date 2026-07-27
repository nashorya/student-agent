/**
 * Tool trace → lesson evidence. Shared by the eval runner and the interactive
 * reflect hook so both sides feed the lesson writer identical material.
 */

/** Minimal structural view of a completed tool call. */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: unknown;
  endedAt?: string;
  isError?: boolean;
}

export interface ToolVerificationEvidence {
  toolCallId: string;
  toolName: string;
  exitCode: number;
  completedAt: string;
}

export interface ToolOperationEvidence {
  toolName: string;
  completedAt: string;
  summary?: string;
}

/** Successful test/lint/build commands — in-stream exit-0 terminators. */
export function buildVerificationEvidence(
  toolCalls: ToolCallRecord[],
): ToolVerificationEvidence[] {
  return toolCalls.flatMap((call) => {
    if (call.isError !== false || !call.endedAt || !isProcessTool(call.name)) {
      return [];
    }
    const command = extractStringArg(call.args, 'command');
    if (!command || !isVerificationCommand(command)) {
      return [];
    }
    return [{
      toolCallId: call.id,
      toolName: call.name,
      exitCode: 0,
      completedAt: call.endedAt,
    }];
  });
}

/** Non-error tool ops for provisional causal pairs (error → recovery tools). */
export function buildOperationEvidence(
  toolCalls: ToolCallRecord[],
): ToolOperationEvidence[] {
  return toolCalls.flatMap((call) => {
    if (call.isError === true || !call.endedAt) return [];
    return [{
      toolName: call.name,
      completedAt: call.endedAt,
      summary: buildOperationSummary(call.args),
    }];
  });
}

/** Edit payload text — φ_exec grounding corpus (fidelity v3). */
export function buildOperationSummary(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const record = args as Record<string, unknown>;
  const parts = [
    'path',
    'file_path',
    'filePath',
    'patch',
    'newText',
    'new_str',
    'content',
    'command',
  ]
    .map((key) => (typeof record[key] === 'string' ? record[key] as string : ''))
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 2_000);
}

function isProcessTool(name: string): boolean {
  return /^(?:student_)?(?:bash|shell|exec)$/.test(name.toLowerCase());
}

function extractStringArg(args: unknown, key: string): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function isVerificationCommand(command: string): boolean {
  return /\b(?:test|tests|pytest|vitest|jest|tsc|lint|check|verify)\b/i.test(command);
}
