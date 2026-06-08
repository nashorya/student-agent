import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { getProjectMemoryDir } from '../../core/paths.js';
import { BoundedBreaker } from '../../reflect/bounded-breaker.js';
import type { PreferenceCandidate } from '../candidates/types.js';
import type { LessonCandidate } from '../lessons/types.js';
import type { Knack } from './types.js';

export interface PromoteLessonCandidateOptions {
  breaker?: BoundedBreaker;
  totalTaskCount: number;
}

export class KnacksManager {
  private static instance: KnacksManager | null = null;
  private readonly filePath: string;

  private constructor(memoryDir: string) {
    this.filePath = join(memoryDir, 'knacks.jsonl');
  }

  static getInstance(memoryDir?: string): KnacksManager {
    const dir = memoryDir ?? getProjectMemoryDir();
    if (!KnacksManager.instance) {
      KnacksManager.instance = new KnacksManager(dir);
    }
    return KnacksManager.instance;
  }

  static resetInstance(): void {
    KnacksManager.instance = null;
  }

  async getAll(): Promise<Knack[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return raw.split('\n').filter(Boolean).flatMap((line) => {
        try {
          return [JSON.parse(line) as Knack];
        } catch {
          return [];
        }
      });
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async getPromptInjectableKnacks(): Promise<Knack[]> {
    const knacks = await this.getAll();
    return knacks.filter((knack) =>
      knack.allowPromptInjection
      && (knack.status === 'candidate' || knack.status === 'validated'),
    );
  }

  async promoteLessonCandidate(
    lesson: LessonCandidate,
    options: PromoteLessonCandidateOptions,
  ): Promise<Knack> {
    const breaker = options.breaker ?? new BoundedBreaker();
    const breakerDecision = await breaker.evaluate({
      candidate: lessonToBreakerCandidate(lesson),
      totalTaskCount: options.totalTaskCount,
    });
    const now = new Date().toISOString();
    const hasHighSeverityCounterexample = (lesson.counterexamples ?? [])
      .some((counterexample) => counterexample.severity === 'high');

    const knack: Knack = {
      id: `knack_${randomUUID()}`,
      lessonCandidateId: lesson.id,
      status: 'candidate',
      summary: lesson.lesson,
      trigger: lesson.trigger,
      recall: {
        trigger: lesson.trigger,
        applicableWhen: lesson.applicableWhen,
        doNotApplyWhen: lesson.doNotApplyWhen,
      },
      evidenceRefs: lesson.evidenceRefs,
      counterexamples: lesson.counterexamples ?? [],
      allowPromptInjection: !hasHighSeverityCounterexample && breakerDecision.action !== 'reject',
      writesHardToolRule: false,
      breakerReport: breakerDecision.report,
      createdAt: now,
      updatedAt: now,
    };

    await this.append(knack);
    return knack;
  }

  private async append(knack: Knack): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(knack) + '\n', 'utf-8');
  }
}

function lessonToBreakerCandidate(lesson: LessonCandidate): PreferenceCandidate {
  const triggerContext = [
    ...lesson.trigger.signalKinds,
    ...lesson.trigger.paths,
    ...(lesson.trigger.toolNames ?? []),
    ...(lesson.trigger.ruleNames ?? []),
  ].join(', ');

  return {
    id: lesson.id,
    pattern: lesson.lesson,
    scope: 'tool-preference',
    observations: 5,
    first_observed: lesson.createdAt,
    last_observed: lesson.updatedAt,
    contradictions: 0,
    status: 'observed',
    trigger_context: triggerContext,
    breaker_report: null,
    provenance: [{
      source_type: 'reflect-agent',
      task_id: lesson.provenance.taskId,
      session_ref: lesson.provenance.sessionRef,
      trust_status: 're-observed',
    }],
  };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
