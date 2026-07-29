import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInjectionBuildMemoryPrompt, seedContextRuntimeEvalMemory } from '../context-runtime-runner.js';
import { promoteHarnessEligibleLessons } from '../eval-learning-lifecycle.js';
import { recordInjectionAdmission } from '../injection-admission.js';
import type { EvalTaskDefinition } from '../types.js';
import type { Knack } from '../../memory/knacks/types.js';
import type { LessonCandidate } from '../../memory/lessons/types.js';

describe('injection memory policies', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it('injects only the policy-selected, harness-eligible memory on a common context', async () => {
    const root = await memoryFixture();
    const prompts: Record<string, string> = {};
    for (const mode of ['lesson-recall', 'knack-recall', 'off', 'lesson-full'] as const) {
      await seedContextRuntimeEvalMemory({ memoryDir: root, task: task(root), instruction: 'Fix migration reference serialization.' });
      prompts[mode] = await (await createInjectionBuildMemoryPrompt(mode, root))();
    }

    for (const prompt of Object.values(prompts)) expect(prompt).toContain('### taskSpec');
    expect(prompts['lesson-recall']).toContain('[recall:lesson_resolved]');
    expect(prompts['lesson-recall']).not.toContain('lesson_unresolved');
    expect(prompts['lesson-recall']).not.toContain('knack_resolved');
    expect(prompts['knack-recall']).toContain('[recall:knack_resolved]');
    expect(prompts['knack-recall']).not.toContain('knack_unresolved');
    expect(prompts['knack-recall']).not.toContain('lesson_resolved');
    expect(prompts.off).not.toMatch(/\[(?:recall|resident):/u);
    expect(prompts['lesson-full']).toContain('[resident:lesson_resolved]');
    expect(prompts['lesson-full']).not.toContain('lesson_unresolved');
    expect(prompts['lesson-full']).not.toContain('ephemeral_secret');
    expect(Object.values(prompts).every((prompt) =>
      !/historical_secret|preference_secret|doc_secret/u.test(prompt))).toBe(true);
  });

  it('does not let unresolved lessons contribute to knack promotion', async () => {
    const root = await memoryFixture();
    await writeFile(join(root, 'knacks.jsonl'), '');
    await seedContextRuntimeEvalMemory({
      memoryDir: root,
      task: task(root),
      instruction: 'Fix migration reference serialization.',
    });
    expect(await (await createInjectionBuildMemoryPrompt('knack-recall', root))())
      .not.toContain('[recall:');

    expect(await promoteHarnessEligibleLessons({
      memoryDir: root, eligibleRunIds: ['run_resolved'], totalTaskCount: 2,
    })).toBe(0);
    expect(await readJsonl(join(root, 'knacks.jsonl'))).toHaveLength(0);

    await recordInjectionAdmission(root, {
      runId: 'run_unresolved', taskId: 'task_unresolved', instanceId: 'repo__project-2', resolved: true,
    });
    expect(await promoteHarnessEligibleLessons({
      memoryDir: root, eligibleRunIds: ['run_resolved', 'run_unresolved'], totalTaskCount: 2,
    })).toBe(2);
    expect(await readJsonl(join(root, 'knacks.jsonl'))).toHaveLength(2);
    expect(await (await createInjectionBuildMemoryPrompt('knack-recall', root))())
      .toContain('[recall:knack_');
  });

  async function memoryFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'injection-policy-'));
    roots.push(root);
    await mkdir(join(root, 'ephemeral'), { recursive: true });
    const lessons = [
      lesson('lesson_resolved', 'run_resolved', 'Preserve the qualified migration reference name.'),
      lesson('lesson_unresolved', 'run_unresolved', 'unresolved_secret'),
    ];
    await writeFile(join(root, 'lessons.jsonl'), lessons.map((item) => JSON.stringify(item)).join('\n') + '\n');
    await writeFile(join(root, 'ephemeral', 'lessons.jsonl'), `${JSON.stringify({
      ...lesson('lesson_ephemeral', 'run_resolved', 'ephemeral_secret'), quality: 'low',
    })}\n`);
    const knacks = [
      knack('knack_resolved', 'lesson_resolved', 'Preserve the qualified migration reference name.'),
      knack('knack_unresolved', 'lesson_unresolved', 'unresolved_knack_secret'),
    ];
    await writeFile(join(root, 'knacks.jsonl'), knacks.map((item) => JSON.stringify(item)).join('\n') + '\n');
    await writeFile(join(root, 'preferences.md'), JSON.stringify({ preferences: [{
      id: 'preference_secret', rule: 'preference_secret', scope: 'global',
      provenance: { source_type: 'reflect-agent', created_at: '2026-07-20T00:00:00.000Z' },
    }] }));
    await writeFile(join(root, 'doc-findings.jsonl'), `${JSON.stringify({
      id: 'doc_secret', title: 'doc_secret', summary: 'doc_secret', source: 'test',
      recall: { trigger: {}, applicableWhen: [], doNotApplyWhen: [] }, evidenceRefs: [],
      createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
    })}\n`);
    await recordInjectionAdmission(root, {
      runId: 'run_resolved', taskId: 'task_resolved', instanceId: 'repo__project-1', resolved: true,
    });
    await recordInjectionAdmission(root, {
      runId: 'run_unresolved', taskId: 'task_unresolved', instanceId: 'repo__project-2', resolved: false,
    });
    await mkdir(join(root, 'runs', 'old'), { recursive: true });
    await writeFile(join(root, 'runs', 'old', 'outcome.json'), JSON.stringify({
      taskId: 'historical', runId: 'old', createdAt: '2026-01-01T00:00:00.000Z',
      wmSnapshot: { taskId: 'historical', runId: 'old', goal: 'historical_secret', phase: 'done',
        currentStep: 'historical_secret', openTodos: [], recentErrors: [], recentSignals: [], keyFiles: [],
        artifactRefs: [], createdAt: '2026-01-01T00:00:00.000Z' },
    }));
    return root;
  }
});

function lesson(id: string, runId: string, text: string): LessonCandidate {
  return {
    id, sourceSignalId: `signal_${id}`, lesson: text,
    trigger: { signalKinds: ['tool_error'], paths: ['django/db/migrations/serializer.py'] },
    applicableWhen: ['migration reference serialization'], doNotApplyWhen: [], evidenceRefs: [id],
    severity: 'medium', quality: 'high', confidence: 'verified', status: 'observed',
    provenance: { taskId: `task_${id}`, sessionRef: runId, signalId: `signal_${id}` },
    createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

function knack(id: string, lessonCandidateId: string, summary: string): Knack {
  const trigger = { signalKinds: ['tool_error'] as const, paths: ['django/db/migrations/serializer.py'] };
  return {
    id, lessonCandidateId, status: 'candidate', summary, trigger,
    recall: { trigger, applicableWhen: ['migration reference serialization'], doNotApplyWhen: [] },
    evidenceRefs: [id], counterexamples: [], allowPromptInjection: true, writesHardToolRule: false,
    breakerReport: null, createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

function task(root: string): EvalTaskDefinition {
  return {
    id: 'django__django-next', title: 'migration reference serialization', mode: 'direct',
    workspace: root, instructionPath: join(root, 'instruction.md'),
    fixture: { workspace: root, files: {}, seed: [], verification: { commands: [] } },
    rubric: { required: [], forbidden: [], testScriptPath: '' },
  };
}

async function readJsonl(path: string): Promise<unknown[]> {
  try { return (await readFile(path, 'utf8')).trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
}
