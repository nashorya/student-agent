import type { Api, Model } from '@mariozechner/pi-ai';
import type {
  CreateStudentSessionOptions,
  CreateStudentSessionResult,
  StudentAgentHooks,
} from '../core/pi-bridge/session-factory.js';
import { createStudentSession } from '../core/pi-bridge/session-factory.js';
import type { SubAgentTask } from './planner.js';
import type { SubAgentExecutor, SubAgentRunResult } from './orchestrator.js';
import { WorktreeManager } from './worktree-manager.js';

export interface PiSubAgentExecutorOptions {
  cwd: string;
  model?: Model<Api>;
  hooks: StudentAgentHooks;
  createSession?: (options: CreateStudentSessionOptions) => Promise<CreateStudentSessionResult>;
  worktreeManager?: WorktreeManager;
}

export class PiSubAgentExecutor implements SubAgentExecutor {
  private readonly createSession: (options: CreateStudentSessionOptions) => Promise<CreateStudentSessionResult>;
  private readonly worktreeManager: WorktreeManager;

  constructor(private readonly options: PiSubAgentExecutorOptions) {
    this.createSession = options.createSession ?? createStudentSession;
    this.worktreeManager = options.worktreeManager ?? new WorktreeManager({ rootCwd: options.cwd });
  }

  async execute(
    task: SubAgentTask,
    signal: AbortSignal,
  ): Promise<Omit<SubAgentRunResult, 'taskId'>> {
    if (signal.aborted) {
      return {
        status: 'failed',
        summary: 'Sub-agent aborted before start',
        writtenFiles: [],
        error: 'aborted',
      };
    }

    const lease = await this.worktreeManager.create(task.id);

    try {
      const { session, agent } = await this.createSession({
        cwd: lease.path,
        model: this.options.model,
        hooks: this.options.hooks,
      });
      await session.prompt(renderSubAgentPrompt(task));
      await agent.waitForIdle();
      const [patch, writtenFiles] = await Promise.all([
        this.worktreeManager.collectPatch(lease),
        this.worktreeManager.collectWrittenFiles(lease),
      ]);
      return {
        status: 'success',
        summary: extractLastAssistantText(agent.state.messages) || 'Sub-agent completed',
        writtenFiles,
        patch,
      };
    } catch (err) {
      return {
        status: 'failed',
        summary: 'Sub-agent failed',
        writtenFiles: [],
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await this.worktreeManager.cleanup(lease);
    }
  }
}

function renderSubAgentPrompt(task: SubAgentTask): string {
  return [
    `子任务：${task.title}`,
    '',
    task.prompt,
    '',
    '读取意图：',
    ...(task.readIntent ?? []).map((path) => `- ${path}`),
    '',
    '写入意图：',
    ...task.writeIntent.map((path) => `- ${path}`),
  ].join('\n');
}

function extractLastAssistantText(messages: unknown[]): string {
  const last = messages[messages.length - 1];
  if (!isAssistantMessage(last)) {
    return '';
  }

  return last.content
    .filter((part): part is { type: 'text'; text: string } => (
      isRecord(part)
      && part.type === 'text'
      && typeof part.text === 'string'
    ))
    .map((part) => part.text)
    .join('');
}

function isAssistantMessage(value: unknown): value is {
  role: 'assistant';
  content: unknown[];
} {
  return (
    isRecord(value)
    && value.role === 'assistant'
    && Array.isArray(value.content)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
