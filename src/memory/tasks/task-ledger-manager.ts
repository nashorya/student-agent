import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import type {
  LedgerFact,
  LedgerQuestion,
  LedgerRejection,
  TaskLedger,
  TaskLedgerInput,
} from './task-ledger.js';

export class TaskLedgerManager {
  constructor(private readonly memoryDir: string, private readonly taskId: string) {}

  async load(): Promise<TaskLedger> {
    try {
      return JSON.parse(await readFile(this.ledgerPath(), 'utf-8')) as TaskLedger;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return this.emptyLedger();
      throw err;
    }
  }

  async save(ledger: TaskLedger): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      await mkdir(dirname(this.ledgerPath()), { recursive: true });
      await writeFile(this.ledgerPath(), JSON.stringify(ledger, null, 2), 'utf-8');
    });
  }

  async addFact(input: Omit<LedgerFact, 'id' | 'addedAt'>): Promise<LedgerFact> {
    if (input.content.trim() === '') {
      throw new Error('Fact content must not be empty');
    }

    const fact: LedgerFact = {
      ...input,
      id: `fact_${shortId()}`,
      addedAt: new Date().toISOString(),
    };
    await this.update((ledger) => {
      ledger.facts.push(fact);
    });
    return fact;
  }

  async addRejection(
    input: Omit<LedgerRejection, 'id' | 'addedAt' | 'removedAt' | 'removalSource'>,
  ): Promise<LedgerRejection> {
    if (input.assumption.trim() === '') {
      throw new Error('Rejection assumption must not be empty');
    }
    if (input.reason.trim() === '') {
      throw new Error('Rejection reason must not be empty');
    }
    if (input.severity === 'hard' && input.source === 'tool_error') {
      throw new Error('Hard rejection requires user correction or explicit source');
    }

    const rejection: LedgerRejection = {
      ...input,
      id: `rej_${shortId()}`,
      addedAt: new Date().toISOString(),
    };
    await this.update((ledger) => {
      ledger.rejections.push(rejection);
    });
    return rejection;
  }

  async removeRejection(id: string, removalSource: 'user_explicit'): Promise<boolean> {
    let removed = false;
    await this.update((ledger) => {
      const rejection = ledger.rejections.find((item) => item.id === id);
      if (!rejection || rejection.removedAt) return false;
      rejection.removedAt = new Date().toISOString();
      rejection.removalSource = removalSource;
      removed = true;
      return true;
    });
    return removed;
  }

  async addQuestion(
    input: Omit<LedgerQuestion, 'id' | 'addedAt' | 'status' | 'resolvedAt'>,
  ): Promise<LedgerQuestion> {
    if (input.question.trim() === '') {
      throw new Error('Question must not be empty');
    }
    if (input.context.trim() === '') {
      throw new Error('Question context must not be empty');
    }

    const question: LedgerQuestion = {
      ...input,
      id: `q_${shortId()}`,
      status: 'open',
      addedAt: new Date().toISOString(),
    };
    await this.update((ledger) => {
      ledger.questions.push(question);
    });
    return question;
  }

  async resolveQuestion(id: string, resolution: string): Promise<boolean> {
    if (resolution.trim() === '') {
      throw new Error('Question resolution must not be empty');
    }

    let resolved = false;
    await this.update((ledger) => {
      const question = ledger.questions.find((item) => item.id === id);
      if (!question || question.status !== 'open') return false;
      question.status = 'resolved';
      question.resolution = resolution;
      question.resolvedAt = new Date().toISOString();
      resolved = true;
      return true;
    });
    return resolved;
  }

  async getActiveRejections(): Promise<LedgerRejection[]> {
    const ledger = await this.load();
    return ledger.rejections.filter((rejection) => !rejection.removedAt);
  }

  async getOpenQuestions(): Promise<LedgerQuestion[]> {
    const ledger = await this.load();
    return ledger.questions.filter((question) => question.status === 'open');
  }

  async toLedgerInput(): Promise<TaskLedgerInput> {
    const ledger = await this.load();
    return {
      confirmedFacts: ledger.facts,
      rejectedAssumptions: ledger.rejections.filter((rejection) => !rejection.removedAt),
      openQuestions: ledger.questions.filter((question) => question.status === 'open'),
    };
  }

  private async update(mutator: (ledger: TaskLedger) => void | boolean): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const ledger = await this.load();
      const changed = mutator(ledger);
      if (changed === false) return;
      ledger.updatedAt = new Date().toISOString();
      await mkdir(dirname(this.ledgerPath()), { recursive: true });
      await writeFile(this.ledgerPath(), JSON.stringify(ledger, null, 2), 'utf-8');
    });
  }

  private emptyLedger(): TaskLedger {
    return {
      taskId: this.taskId,
      facts: [],
      rejections: [],
      questions: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private ledgerPath(): string {
    return join(this.memoryDir, 'tasks', this.taskId, 'ledger.json');
  }
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
