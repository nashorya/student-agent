import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getProjectMemoryDir } from '../../core/paths.js';
import { WriteQueue } from '../../core/write-queue.js';
import type { RunEvent, TaskOutcome, WorkingMemorySnapshot } from './types.js';

export interface RunArchiveWriterOptions {
  memoryDir?: string;
}

export class RunArchiveWriter {
  private readonly memoryDir: string;

  constructor(options: RunArchiveWriterOptions = {}) {
    this.memoryDir = options.memoryDir ?? getProjectMemoryDir();
  }

  async startRun(_taskId: string, runId: string): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      await mkdir(this.runDir(runId), { recursive: true });
    });
  }

  async appendEvent(runId: string, event: RunEvent): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      await mkdir(this.runDir(runId), { recursive: true });
      await appendFile(this.eventsPath(runId), JSON.stringify(event) + '\n', 'utf-8');
    });
  }

  async finalizeRun(
    runId: string,
    options: {
      taskId: string;
      status: TaskOutcome['status'];
      userAccepted?: boolean;
      finalSummary: string;
      wmSnapshot?: WorkingMemorySnapshot;
    },
  ): Promise<TaskOutcome> {
    return WriteQueue.getInstance().enqueue(async () => {
      await mkdir(this.runDir(runId), { recursive: true });
      const events = await readEvents(this.eventsPath(runId));
      const outcome = makeOutcome(runId, options, events);
      await writeFile(this.outcomePath(runId), JSON.stringify(outcome, null, 2), 'utf-8');
      return outcome;
    });
  }

  private runDir(runId: string): string {
    return join(this.memoryDir, 'runs', runId);
  }

  private eventsPath(runId: string): string {
    return join(this.runDir(runId), 'events.jsonl');
  }

  private outcomePath(runId: string): string {
    return join(this.runDir(runId), 'outcome.json');
  }
}

async function readEvents(filePath: string): Promise<RunEvent[]> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return raw.split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as RunEvent];
      } catch {
        return [];
      }
    });
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
}

function makeOutcome(
  runId: string,
  options: {
    taskId: string;
    status: TaskOutcome['status'];
    userAccepted?: boolean;
    finalSummary: string;
    wmSnapshot?: WorkingMemorySnapshot;
  },
  events: RunEvent[],
): TaskOutcome {
  return {
    taskId: options.taskId,
    runId,
    status: options.status,
    userAccepted: options.userAccepted,
    userCorrectionCount: countKind(events, 'user_correction'),
    toolErrorCount: countKind(events, 'tool_error'),
    hashlineRejectionCount: countKind(events, 'hashline_rejection'),
    hashlineRecoveryCount: countKind(events, 'hashline_recovery'),
    repeatedToolCallCount: countRepeatedToolCalls(events),
    lostnessTriggerCount: countKind(events, 'lostness_hard') + countKind(events, 'lostness_soft'),
    finalSummary: options.finalSummary,
    evidenceRefs: collectEvidenceRefs(events),
    wmSnapshot: options.wmSnapshot,
    createdAt: new Date().toISOString(),
  };
}

function countKind(events: RunEvent[], kind: RunEvent['kind']): number {
  return events.filter((event) => event.kind === kind).length;
}

function countRepeatedToolCalls(events: RunEvent[]): number {
  let previousToolName: string | undefined;
  let repeated = 0;
  for (const event of events) {
    if (event.kind !== 'tool_call') continue;
    if (event.toolName && event.toolName === previousToolName) repeated++;
    previousToolName = event.toolName;
  }
  return repeated;
}

function collectEvidenceRefs(events: RunEvent[]): string[] {
  const refs = events.flatMap((event) => {
    const ref = event.metadata?.evidenceRef;
    if (typeof ref === 'string') return [ref];
    if (Array.isArray(ref)) return ref.filter((value): value is string => typeof value === 'string');
    return [];
  });
  return [...new Set(refs)];
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
