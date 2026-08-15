import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LessonsManager } from '../../../memory/lessons/manager.js';
import {
  WRITE_LESSON_AEVO_GUIDELINE,
  WRITE_LESSON_INSTRUCTION,
} from '../../../memory/lessons/write-lesson-instruction.js';
import { formatWriteLessonArcReminder } from '../../../memory/lessons/write-lesson-instruction.js';
import {
  classifyWriteLessonError,
  createWriteLessonToolDefinition,
  detectWriteLessonArc,
  LessonArcRegistry,
  recordWriteLessonAfterToolCall,
  recordWriteLessonBeforeToolCall,
} from '../write-lesson-tool.js';

const ROOT_CAUSE = 'CompoundModel separability copies ones into the right block';
const FIX_METHOD = 'Assign the actual right-hand separability matrix into cright';

function toolParams(overrides: Record<string, unknown> = {}) {
  return {
    whatWentWrong: 'Filled the right block with ones after a failed assertion',
    rootCause: ROOT_CAUSE,
    fixMethod: FIX_METHOD,
    contrast: 'Fill-with-ones drops nested structure; copy preserves the child matrix',
    doNotApplyWhen: 'The right block is already a view that must stay shared',
    symptomKeys: ['separability', 'CompoundModel', 'cright'],
    evidence: { arcId: 'arc-1' },
    docRefs: [{ library: 'astropy', topic: 'modeling.separable' }],
    ...overrides,
  };
}

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

describe('write_lesson tool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'write-lesson-tool-'));
    LessonsManager.resetInstance();
  });

  afterEach(async () => {
    LessonsManager.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('records an anchored cited triple and returns one confirmation line without the lesson body', async () => {
    const sessionEvents = [
      { kind: 'tool_error', toolCallId: 'err_1', id: 'err_1', toolName: 'bash', isError: true },
      { kind: 'tool_call', toolCallId: 'fix_1', id: 'fix_1', toolName: 'edit', exitCode: 0 },
      { kind: 'tool_call', toolCallId: 'verify_1', id: 'verify_1', toolName: 'bash', exitCode: 0 },
    ];
    const arcRegistry = new LessonArcRegistry();
    arcRegistry.issue({
      errorToolCallId: 'err_1',
      fixToolCallIds: ['fix_1'],
      verificationToolCallId: 'verify_1',
    });
    const tool = createWriteLessonToolDefinition({
      memoryDir: tmpDir,
      getTaskId: () => 'task_model',
      getSessionRef: () => 'run_model',
      repo: 'astropy/astropy',
      sessionEvents,
      arcRegistry,
    });

    const result = await tool.execute('write_1', toolParams());
    const text = resultText(result);

    expect(tool.name).toBe('write_lesson');
    expect(text).toMatch(/^Recorded lesson lesson_[0-9a-f-]+ \(anchored\)\.$/);
    expect(text).not.toContain('\n');
    expect(text).not.toContain(ROOT_CAUSE);
    expect(text).not.toContain(FIX_METHOD);
    expect(text).not.toContain('whatWentWrong');
    expect(text).not.toContain('Fill-with-ones');

    const mgr = LessonsManager.getInstance(tmpDir);
    const main = await mgr.getAll();
    expect(main).toHaveLength(1);
    expect(main[0].id).toMatch(/^lesson_/);
    expect(main[0].audit).toBe('anchored');
    expect(main[0].authoredBy).toBe('model');
    expect(main[0].evidence).toEqual({
      errorToolCallId: 'err_1',
      fixToolCallIds: ['fix_1'],
      verificationToolCallId: 'verify_1',
    });
    expect(await mgr.getEphemeral()).toHaveLength(0);
    expect(text).toContain(main[0].id);
    expect(arcRegistry.unclaimedIds()).toEqual([]);
  });

  it('returns one unanchored line when a cited id is missing and isolates to ephemeral', async () => {
    const sessionEvents = [
      { kind: 'tool_error', toolCallId: 'err_1', id: 'err_1', toolName: 'bash', isError: true },
      { kind: 'tool_call', toolCallId: 'fix_1', id: 'fix_1', toolName: 'edit', exitCode: 0 },
      { kind: 'tool_call', toolCallId: 'verify_1', id: 'verify_1', toolName: 'bash', exitCode: 0 },
    ];
    const tool = createWriteLessonToolDefinition({
      memoryDir: tmpDir,
      getTaskId: () => 'task_model',
      getSessionRef: () => 'run_model',
      sessionEvents,
      arcRegistry: new LessonArcRegistry(),
    });

    const result = await tool.execute('write_2', toolParams({
      evidence: { arcId: 'arc-missing' },
    }));
    const text = resultText(result);

    expect(text).toMatch(/^Recorded lesson lesson_[0-9a-f-]+ \(unanchored\)\.$/);
    expect(text).not.toContain(ROOT_CAUSE);
    expect(text).not.toContain(FIX_METHOD);

    const mgr = LessonsManager.getInstance(tmpDir);
    expect(await mgr.getAll()).toEqual([]);
    const ephemeral = await mgr.getEphemeral();
    expect(ephemeral).toHaveLength(1);
    expect(ephemeral[0].audit).toBe('unanchored');
    expect(result.details).toMatchObject({
      errorKind: 'audit',
      message: 'invalid or expired arcId: arc-missing',
    });
    expect(text).toContain(ephemeral[0].id);
  });

  it('points promptSnippet/guidelines at the freeze instruction plus the AEvo line', () => {
    const tool = createWriteLessonToolDefinition({
      memoryDir: tmpDir,
      sessionEvents: [],
    });
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';
    expect(tool.promptSnippet).toContain('write_lesson');
    expect(guidelines).toContain(WRITE_LESSON_INSTRUCTION);
    expect(guidelines).toContain(WRITE_LESSON_AEVO_GUIDELINE);
  });

  it('upserts after-hook shapes so the auditor sees error/green, not the in-flight before event', () => {
    const sessionEvents: Record<string, unknown>[] = [];
    recordWriteLessonBeforeToolCall(sessionEvents, { toolCallId: 'err_1', toolName: 'bash' });
    recordWriteLessonAfterToolCall(sessionEvents, { toolCallId: 'err_1', toolName: 'bash', isError: true });
    recordWriteLessonBeforeToolCall(sessionEvents, { toolCallId: 'fix_1', toolName: 'edit' });
    recordWriteLessonAfterToolCall(sessionEvents, { toolCallId: 'fix_1', toolName: 'edit', isError: false });
    recordWriteLessonBeforeToolCall(sessionEvents, { toolCallId: 'verify_1', toolName: 'bash' });
    recordWriteLessonAfterToolCall(sessionEvents, { toolCallId: 'verify_1', toolName: 'bash', isError: false });

    expect(sessionEvents).toEqual([
      { kind: 'tool_error', toolCallId: 'err_1', id: 'err_1', toolName: 'bash', isError: true },
      { kind: 'tool_call', toolCallId: 'fix_1', id: 'fix_1', toolName: 'edit', exitCode: 0 },
      { kind: 'tool_call', toolCallId: 'verify_1', id: 'verify_1', toolName: 'bash', exitCode: 0 },
    ]);
  });

  it('reminds once on error→same-tool green and not when there is no error', () => {
    const sessionEvents: Record<string, unknown>[] = [];
    const reminded = new Set<string>();
    const registry = new LessonArcRegistry();
    recordWriteLessonAfterToolCall(sessionEvents, {
      toolCallId: 'err_1', toolName: 'bash', isError: true, path: 'a.py',
    });
    const first = detectWriteLessonArc(sessionEvents, {
      toolCallId: 'ok_1', toolName: 'bash', isError: false, path: 'a.py',
    }, reminded, registry);
    const second = detectWriteLessonArc(sessionEvents, {
      toolCallId: 'ok_2', toolName: 'bash', isError: false, path: 'a.py',
    }, reminded, registry);
    expect(first).toBe(formatWriteLessonArcReminder('arc-1'));
    expect(second).toBeUndefined();
    expect(registry.unclaimedIds()).toEqual(['arc-1']);
    expect(detectWriteLessonArc([], {
      toolCallId: 'ok_3', toolName: 'edit', isError: false,
    }, new Set(), new LessonArcRegistry())).toBeUndefined();
  });

  it('puts errorKind and a one-line message in details without echoing the body', async () => {
    LessonsManager.resetInstance();
    const blocker = join(tmpDir, 'not-a-dir');
    await writeFile(blocker, 'x');
    const tool = createWriteLessonToolDefinition({
      memoryDir: blocker,
      sessionEvents: [],
    });
    const result = await tool.execute('write_fail', toolParams());
    expect(resultText(result)).toBe('Recorded lesson failed.');
    expect(result.details).toMatchObject({
      ok: false,
      errorKind: expect.stringMatching(/^(io|unknown)$/),
    });
    expect(String(result.details.message)).not.toContain('\n');
    expect(resultText(result)).not.toContain(ROOT_CAUSE);
  });

  it('issues incrementing arc handles and harvest lists only unclaimed ids', () => {
    const sessionEvents: Record<string, unknown>[] = [];
    const reminded = new Set<string>();
    const registry = new LessonArcRegistry();
    recordWriteLessonAfterToolCall(sessionEvents, {
      toolCallId: 'err_1', toolName: 'bash', isError: true, path: 'a.py',
    });
    recordWriteLessonAfterToolCall(sessionEvents, {
      toolCallId: 'fix_1', toolName: 'edit', isError: false, path: 'a.py',
    });
    const first = detectWriteLessonArc(sessionEvents, {
      toolCallId: 'ok_1', toolName: 'bash', isError: false, path: 'a.py',
    }, reminded, registry);
    recordWriteLessonAfterToolCall(sessionEvents, {
      toolCallId: 'err_2', toolName: 'edit', isError: true, path: 'b.py',
    });
    const second = detectWriteLessonArc(sessionEvents, {
      toolCallId: 'ok_2', toolName: 'edit', isError: false, path: 'b.py',
    }, reminded, registry);
    expect(first).toBe(formatWriteLessonArcReminder('arc-1'));
    expect(second).toBe(formatWriteLessonArcReminder('arc-2'));
    expect(registry.unclaimedIds()).toEqual(['arc-1', 'arc-2']);
    registry.claim('arc-1');
    expect(registry.unclaimedIds()).toEqual(['arc-2']);
  });

  it('isolates a missing arcId as unanchored with audit errorKind', async () => {
    const tool = createWriteLessonToolDefinition({
      memoryDir: tmpDir,
      sessionEvents: [],
      arcRegistry: new LessonArcRegistry(),
    });
    const result = await tool.execute('write_missing', toolParams({ evidence: {} }));
    expect(resultText(result)).toMatch(/^Recorded lesson lesson_[0-9a-f-]+ \(unanchored\)\.$/);
    expect(result.details).toMatchObject({ audit: 'unanchored', errorKind: 'audit', message: 'missing arcId' });
    expect(await LessonsManager.getInstance(tmpDir).getAll()).toEqual([]);
    expect(await LessonsManager.getInstance(tmpDir).getEphemeral()).toHaveLength(1);
  });

  it('allows a second lesson to reuse a claimed arcId and keeps harvest empty', async () => {
    const sessionEvents = [
      { kind: 'tool_error', toolCallId: 'err_1', id: 'err_1', toolName: 'bash', isError: true },
      { kind: 'tool_call', toolCallId: 'fix_1', id: 'fix_1', toolName: 'edit', exitCode: 0 },
      { kind: 'tool_call', toolCallId: 'verify_1', id: 'verify_1', toolName: 'bash', exitCode: 0 },
    ];
    const arcRegistry = new LessonArcRegistry();
    arcRegistry.issue({
      errorToolCallId: 'err_1',
      fixToolCallIds: ['fix_1'],
      verificationToolCallId: 'verify_1',
    });
    const tool = createWriteLessonToolDefinition({
      memoryDir: tmpDir,
      getTaskId: () => 'task_model',
      getSessionRef: () => 'run_model',
      sessionEvents,
      arcRegistry,
    });
    const first = await tool.execute('write_a', toolParams());
    const second = await tool.execute('write_b', toolParams());
    expect(resultText(first)).toMatch(/\(anchored\)\.$/);
    expect(resultText(second)).toMatch(/\(anchored\)\.$/);
    expect(arcRegistry.unclaimedIds()).toEqual([]);
    const main = await LessonsManager.getInstance(tmpDir).getAll();
    expect(main).toHaveLength(2);
    expect(main.every((lesson) => lesson.audit === 'anchored')).toBe(true);
    expect(main.every((lesson) => lesson.evidence?.errorToolCallId === 'err_1')).toBe(true);
  });
});
