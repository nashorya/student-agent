import { classify } from './risk-classifier.js';
import type { SnapshotManager } from './snapshot.js';
import type { ConfirmationProvider, ExecutorTool, ToolResult } from './types.js';
import { ToolExecutionError } from './types.js';
import type { ToolCall } from '../state-machine/types.js';

export interface ExecutorOptions {
  snapshotManager: SnapshotManager;
  confirmationProvider: ConfirmationProvider;
  tools: Map<string, ExecutorTool>;
  onSnapshot?: (sha: string) => void;
}

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
        // mutates results, then throws — terminates this round
        await this.handleRunError(toolCall.name, runErr, sha, results);
      }
    }

    return results;
  }

  /**
   * Pushes a failure ToolResult to `results`, then always throws a ToolExecutionError.
   * Mutates `results` before throwing so the partial result is recorded even though
   * executeRound never returns.
   * Return type `Promise<never>` signals this method always throws.
   */
  private async handleRunError(
    toolName: string,
    runErr: unknown,
    sha: string,
    results: ToolResult[],
  ): Promise<never> {
    try {
      await this.opts.snapshotManager.restore(sha);
      results.push({ toolName, output: null, rolledBack: true });
      // throw here is caught by the catch block below; the instanceof guard re-throws it unchanged
      throw new ToolExecutionError(toolName, runErr, true);
    } catch (restoreErr) {
      // re-throw the ToolExecutionError from the successful-restore path above, not a restore failure
      if (restoreErr instanceof ToolExecutionError) throw restoreErr;
      results.push({ toolName, output: null, rolledBack: false });
      throw new ToolExecutionError(toolName, runErr, false, restoreErr);
    }
  }
}
