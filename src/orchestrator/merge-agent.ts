import type { SubAgentRunResult } from './orchestrator.js';

export interface MergeSummary {
  successful: number;
  failed: number;
  summaries: string[];
}

export class MergeAgent {
  summarize(results: SubAgentRunResult[]): MergeSummary {
    return {
      successful: results.filter((result) => result.status === 'success').length,
      failed: results.filter((result) => result.status !== 'success').length,
      summaries: results.map((result) => `${result.taskId}: ${result.summary}`),
    };
  }
}
