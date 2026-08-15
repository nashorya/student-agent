export interface ToolStats {
  calls: number;
  consecutiveFailures: number;
  lastUsedAt: string | null;
  disabled: boolean;
  disabledReason?: string;
}

export interface ListedTool {
  name: string;
  description: string;
  disabled: boolean;
}

export interface DescribedTool extends ListedTool {
  params?: Record<string, unknown>;
  stats: ToolStats;
  loadError?: string;
}

export interface RunToolResult {
  text: string;
  truncated: boolean;
  timedOut: boolean;
  error?: string;
}

export interface ToolboxModule {
  name: string;
  description?: string;
  params?: Record<string, unknown>;
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}
