export type RiskLevel = 'low' | 'high';

export interface ExecutorTool {
  name: string;
  run(input: Record<string, unknown>): Promise<unknown>;
}

export interface ToolResult {
  toolName: string;
  output: unknown;
  rolledBack: boolean;
}

export interface ConfirmationProvider {
  confirm(op: { toolName: string; input: unknown; reason: string }): Promise<boolean>;
}

export class ToolExecutionError extends Error {
  constructor(
    public readonly toolName: string,
    runError: unknown,
    public readonly rolledBack: boolean,
    public readonly restoreError?: unknown,
  ) {
    super(`Tool execution failed: ${toolName}`, { cause: runError });
    this.name = 'ToolExecutionError';
  }
}

export class UserAbortError extends Error {
  constructor() {
    super('Execution aborted by user');
    this.name = 'UserAbortError';
  }
}
