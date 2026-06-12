import { TasksManager } from '../memory/tasks/manager.js';

export const ZERO_EDIT_CONTINUATION_PROMPT = 'You have not made any edits yet. Continue working on the task now.';
export const MAX_ZERO_EDIT_CONTINUATION_ROUNDS = 2;

interface ContinuationSession {
  prompt(prompt: string): Promise<unknown>;
}

interface ContinuationAgent {
  waitForIdle(): Promise<void>;
}

export class ZeroEditContinuation {
  constructor(
    private readonly dependencies: {
      session: ContinuationSession;
      agent: ContinuationAgent;
      memoryDir: string;
      taskId: string;
    },
  ) {}

  async run(hardConstraints: string): Promise<number> {
    if (!hardConstraints.trim()) return 0;

    let continuationRounds = 0;
    while (continuationRounds < MAX_ZERO_EDIT_CONTINUATION_ROUNDS) {
      if (await this.hasWrittenFiles()) break;
      await this.dependencies.session.prompt(ZERO_EDIT_CONTINUATION_PROMPT);
      await this.dependencies.agent.waitForIdle();
      continuationRounds += 1;
    }
    return continuationRounds;
  }

  private async hasWrittenFiles(): Promise<boolean> {
    const task = await TasksManager.getInstance(this.dependencies.memoryDir).getTask(this.dependencies.taskId);
    return Boolean(task?.working_memory.writeFiles.length);
  }
}
