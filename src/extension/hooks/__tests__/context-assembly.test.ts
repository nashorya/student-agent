import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WriteQueue } from '../../../core/write-queue.js';
import { PreferenceCandidatesManager } from '../../../memory/candidates/manager.js';
import { PlanRevisionManager } from '../../../memory/plan-revisions/manager.js';
import { PreferencesManager } from '../../../memory/preferences/manager.js';
import { ProjectKbManager } from '../../../memory/project-kb/manager.js';
import { QuestionsManager } from '../../../memory/questions/manager.js';
import { TaskLedgerManager } from '../../../memory/tasks/task-ledger-manager.js';
import { TasksManager } from '../../../memory/tasks/manager.js';
import { RunArchiveWriter } from '../../../memory/run-archive/run-archive-writer.js';
import { createContextAssemblyHook } from '../context-assembly.js';

describe('createContextAssemblyHook', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'context-assembly-test-'));
    resetManagers();
  });

  afterEach(async () => {
    resetManagers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns legacy memory output when useNewPipeline is false', async () => {
    await writeProjectRules(tmpDir, 'Always use rg before broad reads.');

    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: false,
    })();

    expect(prompt).toContain('Student Agent 记忆上下文');
    expect(prompt).toContain('Project Rules');
    expect(prompt).toContain('Always use rg before broad reads.');
    expect(prompt).toContain('文件修改规则');
    expect(prompt).toContain('文件探索规则');
  });

  it('includes hardcoded sections and goal context in new pipeline mode', async () => {
    await writeProjectRules(tmpDir, 'Respect repository conventions.');
    await TasksManager.getInstance(tmpDir).createTask('Context assembly task', ['Build context'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Assemble L1 prompt from working memory',
        phase: 'executing',
        currentStep: 'Render goal section',
        todos: [{
          id: 'todo_1',
          content: 'Wire RecallRouter and ContextBuilder',
          status: 'pending',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    });

    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
    })();

    expect(prompt).toContain('Project Rules');
    expect(prompt).toContain('Respect repository conventions.');
    expect(prompt).toContain('文件修改规则');
    expect(prompt).toContain('Context Assembly');
    expect(prompt).toContain('### taskSpec');
    expect(prompt).toContain('Goal: Assemble L1 prompt from working memory');
    expect(prompt).toContain('### workingMemory');
    expect(prompt).toContain('PI CONTRACT');
    expect(prompt).not.toContain('FULL PI SCHEMA');
    // Instrument-only diagnostics must not enter the subject prompt.
    expect(prompt).not.toContain('context_assembly_diagnostics');
    expect(prompt).not.toContain('Tier: standard');
    // C-2: cache breakpoint after static prefix; dynamic taskSpec after it.
    expect(prompt).toContain('cache_prefix_breakpoint');
    const breakAt = prompt.indexOf('cache_prefix_breakpoint');
    const taskSpecAt = prompt.indexOf('### taskSpec');
    const piAt = prompt.indexOf('PI CONTRACT');
    expect(breakAt).toBeGreaterThan(-1);
    expect(taskSpecAt).toBeGreaterThan(breakAt);
    expect(piAt).toBeGreaterThan(-1);
    expect(piAt).toBeLessThan(breakAt);
  });

  it('keeps real static prefix byte-stable across two full renders (C-2)', async () => {
    await writeProjectRules(tmpDir, 'Respect repository conventions.');
    await TasksManager.getInstance(tmpDir).createTask('Stable prefix task', ['Build'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Byte-stable static prefix',
        phase: 'executing',
        currentStep: 'Render twice',
        hardConstraints: 'Only edit src/target.ts',
        todos: [{
          id: 'todo_1',
          content: 'Keep dynamic todo',
          status: 'pending',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    });
    const hook = createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
      runMode: 'eval',
    });
    const a = await hook();
    const b = await hook();
    const prefix = (prompt: string) => {
      const i = prompt.indexOf('cache_prefix_breakpoint');
      expect(i).toBeGreaterThan(-1);
      return prompt.slice(0, i);
    };
    // Real hardcoded + static builder sections (not synthetic pad).
    expect(prefix(a)).toContain('文件修改规则');
    expect(prefix(a)).toContain('Hashline');
    expect(prefix(a)).toContain('EVAL AUTONOMY RULE');
    expect(prefix(a)).toContain('PI CONTRACT');
    expect(prefix(a)).not.toContain('### taskSpec');
    expect(prefix(a)).toBe(prefix(b));
  });

  it('records L0-L3 context assembly trace when a recorder is provided', async () => {
    await writeProjectRules(tmpDir, 'Respect repository conventions.');
    await TasksManager.getInstance(tmpDir).createTask('Context trace task', ['Build context'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Measure context layers',
        phase: 'executing',
        currentStep: 'Record layer trace',
        todos: [{
          id: 'todo_1',
          content: 'Keep current todo in L2',
          status: 'pending',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    });
    const traces: unknown[] = [];

    await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
      runMode: 'eval',
      piSchemaRenderMode: 'summary',
      onTrace: (trace) => traces.push(trace),
    })();

    expect(traces).toHaveLength(1);
    const trace = traces[0] as {
      tier: string;
      tierReason: string;
      layers: Record<string, { estimatedTokens: number; sectionIds: string[] }>;
      sections: Array<{ id: string; layer: string; estimatedTokens: number }>;
    };
    expect(trace.tier).toBe('standard');
    expect(trace.tierReason).toBe('default_standard');
    expect(trace.layers.L0.estimatedTokens).toBeGreaterThan(0);
    expect(trace.layers.L1.sectionIds).toContain('taskSpec');
    expect(trace.layers.L2.sectionIds).toContain('workingMemory');
    expect(trace.sections.find((section) => section.id === 'taskSpec')?.layer).toBe('L1');
    expect(trace.sections.find((section) => section.id === 'workingMemory')?.layer).toBe('L2');
  });

  it('records recalled item ids and summaries for learning audits', async () => {
    const archive = new RunArchiveWriter({ memoryDir: tmpDir });
    await archive.finalizeRun('run_previous', {
      taskId: 'task_previous',
      status: 'success',
      finalSummary: 'Previous task completed',
      wmSnapshot: {
        taskId: 'task_previous',
        runId: 'run_previous',
        goal: 'Fix an earlier astropy warning failure',
        phase: 'verifying',
        finalStep: 'Run pytest with warning filters',
        completedTodos: [],
        completedTodoCount: 0,
        readFiles: ['astropy/tests/helper.py'],
        writtenFiles: ['astropy/tests/helper.py'],
        keyFiles: [{ path: 'astropy/tests/helper.py', role: 'read_and_written' }],
        keySignalSummaries: ['pytest warning collection failed'],
        errorPatterns: ['warnings treated as errors'],
        evidenceRefs: ['runs/run_previous/outcome.json'],
        createdAt: '2026-06-11T00:00:00.000Z',
      },
    });
    await TasksManager.getInstance(tmpDir).createTask('Current astropy task', ['Build context'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Fix a related astropy warning failure',
        phase: 'executing',
        currentStep: 'Inspect pytest warning behavior',
      },
    });

    const hook = createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
      runMode: 'eval',
    });
    await hook();

    expect(hook.contextAssemblyTraces[0]?.recall?.items).toContainEqual(expect.objectContaining({
      id: 'wm_snapshot:run_previous',
      kind: 'run_archive_ref',
      summary: expect.stringContaining('Fix an earlier astropy warning failure'),
    }));
  });

  it('keeps non-lesson recall when full-resident lessons replace filtered lessons', async () => {
    await PreferencesManager.getInstance(tmpDir).addExplicit({
      rule: 'Prefer concise Chinese answers',
      scope: 'communication',
      taskId: 'task_previous',
      sessionRef: 'session_previous',
    });
    await TasksManager.getInstance(tmpDir).createTask('Full resident context', ['Build context'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Prefer concise Chinese answers while fixing code',
        phase: 'executing',
        currentStep: 'Render full resident lessons',
      },
    });

    const hook = createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
      runMode: 'eval',
      fullResidentLessons: async () => [{ id: 'lesson_1', summary: 'Keep the complete qualified name' }],
    });
    const prompt = await hook();

    expect(prompt).toContain('[resident:lesson_1] Keep the complete qualified name');
    expect(prompt).toContain('Prefer concise Chinese answers');
    expect(hook.contextAssemblyTraces[0]?.recall?.items).toContainEqual(expect.objectContaining({
      kind: 'preference',
      summary: 'Prefer concise Chinese answers',
    }));
  });

  it('injects eval autonomy rule and summary-only pi contract in eval mode', async () => {
    await TasksManager.getInstance(tmpDir).createTask('Eval context task', ['Build eval context'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Run non-interactive eval',
        phase: 'executing',
        currentStep: 'Do not ask user',
      },
    });

    const traces: Array<{ sections?: Array<{ id?: string; content?: string }> }> = [];
    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
      runMode: 'eval',
      piSchemaRenderMode: 'summary',
      onTrace: (trace) => traces.push(trace),
    })();

    expect(prompt).toContain('EVAL AUTONOMY RULE');
    expect(prompt).toContain('PI CONTRACT');
    expect(prompt).not.toContain('FULL PI SCHEMA');
    // Instrument diagnostics must not enter the subject prompt (cache + isolation).
    expect(prompt).not.toContain('context_assembly_diagnostics');
    expect(prompt).not.toContain('Pi schema render mode: summary');
    expect(prompt).not.toContain('Eval autonomy rule enabled: true');
    // Still recorded on the trace side (metadata section id; content is length-only).
    const diag = traces.flatMap((t) => t.sections ?? []).find((s) => s.id === 'contextAssemblyDiagnostics');
    expect(diag).toBeTruthy();
    expect((diag?.estimatedTokens ?? 0) > 0).toBe(true);
  });

  it('renders hard constraints in the prompt and records them as L1 trace', async () => {
    await TasksManager.getInstance(tmpDir).createTask('Hard constraints task', ['Build eval context'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Fix a terminal-bench task',
        hardConstraints: 'Only edit input.tex.\nEvery changed word must stay in its synonyms.txt family.',
        phase: 'executing',
        currentStep: 'Respect hard constraints',
      },
    });
    const traces: unknown[] = [];

    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
      runMode: 'eval',
      piSchemaRenderMode: 'summary',
      onTrace: (trace) => traces.push(trace),
    })();

    expect(prompt).toContain('### hardConstraints');
    expect(prompt).toContain('HARD CONSTRAINTS');
    expect(prompt).toContain('Every changed word must stay in its synonyms.txt family.');
    const trace = traces[0] as {
      layers: Record<string, { sectionIds: string[] }>;
      sections: Array<{ id: string; layer: string }>;
    };
    expect(trace.layers.L1.sectionIds).toContain('hardConstraints');
    expect(trace.sections.find((section) => section.id === 'hardConstraints')?.layer).toBe('L1');
  });

  it('includes task ledger facts, rejections, and questions in new pipeline mode', async () => {
    const task = await TasksManager.getInstance(tmpDir).createTask('Ledger context task', ['Build context'], {
      workflowStatus: 'executing',
      workingMemory: {
        goal: 'Assemble prompt with task ledger',
        phase: 'executing',
        currentStep: 'Render ledger section',
      },
    });
    const ledger = new TaskLedgerManager(tmpDir, task.id);
    await ledger.addFact({
      content: 'Use knacks naming',
      source: 'user',
      confidence: 'confirmed',
    });
    await ledger.addRejection({
      assumption: 'Rename knacks back to strategy genes',
      reason: 'User requested knacks naming',
      source: 'explicit',
      severity: 'hard',
    });
    await ledger.addQuestion({
      question: 'Should Turn Intake populate ledger automatically?',
      context: 'Not part of this MVP',
    });

    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
    })();

    expect(prompt).toContain('### taskLedger');
    expect(prompt).toContain('## Task Ledger');
    expect(prompt).toContain('- [confirmed] Use knacks naming (source: user)');
    expect(prompt).toContain('### Rejected Assumptions — DO NOT revisit these assumptions');
    expect(prompt).toContain('- [HARD] Rename knacks back to strategy genes -- reason: User requested knacks naming');
    expect(prompt).toContain('- Should Turn Intake populate ledger automatically? (context: Not part of this MVP)');
  });

  it('falls back to hardcoded sections plus preferences when no active task exists', async () => {
    await PreferencesManager.getInstance(tmpDir).addExplicit({
      rule: 'Prefer concise Chinese answers',
      scope: 'communication',
      taskId: 'task_1',
      sessionRef: 'session_1',
    });

    const prompt = await createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
    })();

    expect(prompt).toContain('文件修改规则');
    expect(prompt).toContain('User Preferences');
    expect(prompt).toContain('Prefer concise Chinese answers');
    expect(prompt).not.toContain('Context Assembly');
  });

  it('recalls schema-v1 knacks for SWE runs seeded with internal task_* ids', async () => {
    const knackId = 'knack-astropy-astropy-cd70659d7b27';
    await writeFile(join(tmpDir, 'knacks.jsonl'), `${JSON.stringify({
      id: knackId,
      lessonCandidateId: 'lesson_14995',
      status: 'validated',
      summary: 'In v5.3, NDDataRef mask propagation fails when one of the operand does not have a mask',
      trigger: { signalKinds: [], paths: [], toolNames: [] },
      recall: {
        trigger: { signalKinds: [], paths: [], toolNames: [] },
        applicableWhen: ['NDDataRef mask propagation fails'],
        doNotApplyWhen: [],
        tags: ['astropy'],
      },
      evidenceRefs: [],
      counterexamples: [],
      allowPromptInjection: true,
      writesHardToolRule: false,
      breakerReport: null,
      repo: 'astropy/astropy',
      symptom: 'NDDataRef mask propagation fails when one operand has no mask',
      fixSummary: 'In _arithmetic_mask add elif operand.mask is None: return deepcopy(self.mask)',
      reuseCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })}\n`, 'utf8');

    await TasksManager.getInstance(tmpDir).createTask(
      'Eval task: SWE-bench astropy__astropy-14995',
      ['Execute eval task astropy__astropy-14995'],
      {
        workflowStatus: 'executing',
        workingMemory: {
          goal: 'Eval task: SWE-bench astropy__astropy-14995',
          hardConstraints: [
            'Resolve this SWE-bench issue in the current repository.',
            'Instance: astropy__astropy-14995',
            'NDDataRef mask propagation fails when one of the operand does not have a mask',
          ].join('\n'),
          phase: 'executing',
          currentStep: 'Execute eval task astropy__astropy-14995',
        },
      },
    );

    const hook = createContextAssemblyHook({
      memoryDir: tmpDir,
      useNewPipeline: true,
      runMode: 'eval',
      recallKinds: ['knack'],
      includeHistoricalTaskSnapshots: false,
    });
    const prompt = await hook();

    expect(prompt).toContain(`[recall:${knackId}]`);
    expect(hook.contextAssemblyTraces[0]?.recall?.items).toContainEqual(expect.objectContaining({
      id: knackId,
      kind: 'knack',
    }));
    expect(hook.contextAssemblyTraces[0]?.recall?.diagnostics?.dropped ?? []).not.toContainEqual(
      expect.objectContaining({ id: knackId, reason: 'knack_eligibility_failed' }),
    );
  });
});

async function writeProjectRules(memoryDir: string, content: string): Promise<void> {
  await mkdir(memoryDir, { recursive: true });
  await writeFile(join(memoryDir, 'project-rules.md'), content, 'utf-8');
}

function resetManagers(): void {
  PreferenceCandidatesManager.resetInstance();
  PlanRevisionManager.resetInstance();
  PreferencesManager.resetInstance();
  ProjectKbManager.resetInstance();
  QuestionsManager.resetInstance();
  TasksManager.resetInstance();
  WriteQueue.resetInstance();
}
