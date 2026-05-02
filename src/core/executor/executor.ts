import { classify } from './risk-classifier.js';
import type { SnapshotManager } from './snapshot.js';
import type { ConfirmationProvider, ExecutorTool, ToolResult } from './types.js';
import { ToolExecutionError } from './types.js';

export interface ExecutorOptions {
  snapshotManager: SnapshotManager;
  confirmationProvider: ConfirmationProvider;
  tools: Map<string, ExecutorTool>;
  onSnapshot?: (sha: string) => void;
}

type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export class Executor {
  constructor(private readonly opts: ExecutorOptions) {}

  async executeRound(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const tool = this.opts.tools.get(toolCall.name);

      if (tool === undefined) {
        results.push({ toolName: toolCall.name, output: 'tool-not-found', rolledBack: false });
        continue;
      }

      const riskLevel = classify(toolCall.name, toolCall.input);

      if (riskLevel === 'high') {
        const ok = await this.opts.confirmationProvider.confirm({
          toolName: toolCall.name,
          input: toolCall.input,
          reason: 'classified as high-risk',
        });
        if (!ok) {
          results.push({ toolName: toolCall.name, output: 'skipped-by-user', rolledBack: false });
          continue;
        }
      }

      const sha = await this.opts.snapshotManager.create();
      this.opts.onSnapshot?.(sha);

      try {
        const output = await tool.run(toolCall.input);
        results.push({ toolName: toolCall.name, output, rolledBack: false });
      } catch (runErr) {
        await this.handleRunError(toolCall.name, runErr, sha, results);
      }
    }

    return results;
  }

  private async handleRunError(
    toolName: string,
    runErr: unknown,
    sha: string,
    results: ToolResult[],
  ): Promise<never> {
    try {
      await this.opts.snapshotManager.restore(sha);
      results.push({ toolName, output: null, rolledBack: true });
      throw new ToolExecutionError(toolName, runErr, true);
    } catch (restoreErr) {
      if (restoreErr instanceof ToolExecutionError) throw restoreErr;
      results.push({ toolName, output: null, rolledBack: false });
      throw new ToolExecutionError(toolName, runErr, false, restoreErr);
    }
  }
}
