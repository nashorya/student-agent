import type { AgentEvent } from '@earendil-works/pi-agent-core';

export const SELF_CHECK_PROMPT = `Before finishing, perform one evidence-based completion self-check:
1. Use git diff or read tools to list every file change you made. Do not rely on memory.
2. Compare the evidence against every HARD CONSTRAINT.
3. For each constraint, report "satisfied" or "violated" and cite the evidence.
4. If any constraint is violated, fix it immediately and repeat the evidence-based check.
5. Verification must cover EVERY change in the full diff. Spot-checking a few examples is itself a verification failure.
6. If a hard constraint is mechanically checkable against file contents (diffs, word lists, line membership), write and run a small script to verify it exhaustively. Inspection-based verification is only acceptable when scripting is impossible.
Only finish after every HARD CONSTRAINT is confirmed satisfied.`;

export interface CompletionSelfCheckResult {
  ran: boolean;
  toolCalls: number;
  editsMade: boolean;
}

interface SelfCheckSession {
  prompt(prompt: string): Promise<unknown>;
}

interface SelfCheckAgent {
  subscribe(listener: (event: AgentEvent) => void): () => void;
  waitForIdle(): Promise<void>;
}

const MUTATING_TOOLS = new Set([
  'apply_patch',
  'edit',
  'hashline_edit',
  'write',
  'write_file',
]);

export class CompletionSelfCheck {
  private result: CompletionSelfCheckResult | undefined;

  constructor(
    private readonly dependencies: {
      session: SelfCheckSession;
      agent: SelfCheckAgent;
    },
  ) {}

  async run(hardConstraints: string): Promise<CompletionSelfCheckResult> {
    if (this.result) return this.result;
    if (!hardConstraints.trim()) {
      this.result = emptySelfCheckResult();
      return this.result;
    }

    const result: CompletionSelfCheckResult = {
      ran: true,
      toolCalls: 0,
      editsMade: false,
    };
    const unsubscribe = this.dependencies.agent.subscribe((event) => {
      if (event.type !== 'tool_execution_start') return;
      result.toolCalls += 1;
      if (MUTATING_TOOLS.has(normalizeToolName(event.toolName))) {
        result.editsMade = true;
      }
    });

    try {
      await this.dependencies.session.prompt(SELF_CHECK_PROMPT);
      await this.dependencies.agent.waitForIdle();
      this.result = result;
      return result;
    } finally {
      unsubscribe();
    }
  }
}

export function emptySelfCheckResult(): CompletionSelfCheckResult {
  return {
    ran: false,
    toolCalls: 0,
    editsMade: false,
  };
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/^student_/, '');
}
