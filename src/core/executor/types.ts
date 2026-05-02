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
    public readonly cause: unknown,
    public readonly meta: { rolledBack: boolean; cause?: unknown }
  ) {
    super(`Tool execution failed: ${toolName}`);
    this.name = 'ToolExecutionError';
  }
}
