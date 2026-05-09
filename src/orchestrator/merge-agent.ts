import type { SubAgentRunResult } from './orchestrator.js';
import type { SubAgentTask, WriteIntentConflict } from './planner.js';
import { detectWriteIntentConflicts, normalizeWritePath } from './planner.js';

export interface MergeSummary {
  successful: number;
  failed: number;
  summaries: string[];
}

export interface MergeAgentInput {
  tasks: SubAgentTask[];
  results: SubAgentRunResult[];
}

export interface MergeAgentResult extends MergeSummary {
  status: 'merged' | 'blocked';
  conflicts: WriteIntentConflict[];
  patches: string[];
}

export class MergeAgent {
  summarize(results: SubAgentRunResult[]): MergeSummary {
    return {
      successful: results.filter((result) => result.status === 'success').length,
      failed: results.filter((result) => result.status !== 'success').length,
      summaries: results.map((result) => `${result.taskId}: ${result.summary}`),
    };
  }

  synchronize(input: MergeAgentInput): MergeAgentResult {
    const successful = input.results.filter((result) => result.status === 'success');
    const conflicts = [
      ...detectWriteIntentConflicts(input.tasks),
      ...detectRuntimeWriteConflicts(input.results),
    ];
    const summary = this.summarize(input.results);

    return {
      ...summary,
      status: conflicts.length > 0 || summary.failed > 0 ? 'blocked' : 'merged',
      conflicts,
      patches: successful
        .map((result) => result.patch)
        .filter((patch): patch is string => Boolean(patch)),
    };
  }
}

function detectRuntimeWriteConflicts(results: SubAgentRunResult[]): WriteIntentConflict[] {
  const conflicts: WriteIntentConflict[] = [];
  const ownerByPath = new Map<string, string>();
  for (const result of results) {
    for (const rawPath of result.writtenFiles) {
      const path = normalizeWritePath(rawPath);
      const owner = ownerByPath.get(path);
      if (owner && owner !== result.taskId) {
        conflicts.push({
          firstTaskId: owner,
          secondTaskId: result.taskId,
          path,
          kind: 'write-write',
        });
      }
      ownerByPath.set(path, result.taskId);
    }
  }
  return conflicts;
}
