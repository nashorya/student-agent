import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promoteRunLessonsAfterHarness } from '../../../evals/eval-learning-lifecycle.js';
import { LessonsManager } from '../manager.js';
import { renderLessonInjection } from '../render.js';
import { JsonlMemoryStore } from '../../recall/jsonl-memory-store.js';
import {
  createWriteLessonToolDefinition,
  detectWriteLessonArc,
  LessonArcRegistry,
  recordWriteLessonAfterToolCall,
} from '../../../core/pi-bridge/write-lesson-tool.js';

const ROOT_CAUSE = 'CompoundModel separability copies ones into the right block';
const FIX_METHOD = 'Assign the actual right-hand separability matrix into cright';

describe('lesson-supply R8/R9 e2e', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'lesson-supply-e2e-'));
    LessonsManager.resetInstance();
  });

  afterEach(async () => {
    LessonsManager.resetInstance();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('issues arc handle, anchors write_lesson, stamps harness, renders and recalls the body', async () => {
    const sessionEvents: Record<string, unknown>[] = [];
    const registry = new LessonArcRegistry();
    const reminded = new Set<string>();
    recordWriteLessonAfterToolCall(sessionEvents, {
      toolCallId: 'err_1', toolName: 'bash', isError: true, path: 'separable.py',
    });
    recordWriteLessonAfterToolCall(sessionEvents, {
      toolCallId: 'fix_1', toolName: 'edit', isError: false, path: 'separable.py',
    });
    recordWriteLessonAfterToolCall(sessionEvents, {
      toolCallId: 'verify_1', toolName: 'bash', isError: false, path: 'separable.py',
    });

    const reminder = detectWriteLessonArc(sessionEvents, {
      toolCallId: 'verify_1', toolName: 'bash', isError: false, path: 'separable.py',
    }, reminded, registry);
    expect(reminder).toContain('arc-1');
    expect(reminder).toContain('"arcId": "arc-1"');
    expect(registry.unclaimedIds()).toEqual(['arc-1']);

    const tool = createWriteLessonToolDefinition({
      memoryDir: tmpDir,
      getTaskId: () => 'task_e2e',
      getSessionRef: () => 'run_e2e',
      repo: 'astropy/astropy',
      sessionEvents,
      arcRegistry: registry,
    });
    const recorded = await tool.execute('write_e2e', {
      whatWentWrong: 'Filled the right block with ones',
      rootCause: ROOT_CAUSE,
      fixMethod: FIX_METHOD,
      contrast: 'ones drop nested structure; copy preserves it',
      doNotApplyWhen: 'The right block is a shared view',
      symptomKeys: ['separability', 'cright'],
      evidence: { arcId: 'arc-1' },
    });
    expect(recorded.content[0].text).toMatch(/\(anchored\)\.$/);
    expect(registry.unclaimedIds()).toEqual([]);

    const mgr = LessonsManager.getInstance(tmpDir);
    const [anchored] = await mgr.getAll();
    expect(anchored).toMatchObject({
      authoredBy: 'model',
      audit: 'anchored',
      quality: 'high',
      evidence: {
        errorToolCallId: 'err_1',
        fixToolCallIds: ['fix_1'],
        verificationToolCallId: 'verify_1',
      },
    });

    const promo = await promoteRunLessonsAfterHarness({
      memoryDir: tmpDir,
      sessionRef: 'run_e2e',
      reward: 1,
      promotedAt: '2026-08-15T12:00:00.000Z',
    });
    expect(promo.promoted).toBe(1);

    const stamped = (await LessonsManager.getInstance(tmpDir).getAll())[0];
    expect(stamped.promotedAt).toBe('2026-08-15T12:00:00.000Z');
    expect(stamped.confidence).toBe('verified');

    const rendered = renderLessonInjection(stamped);
    expect(rendered.trim()).not.toBe('');
    expect(rendered).toContain(`Cause: ${ROOT_CAUSE}`);
    expect(rendered).toContain(`Fix: ${FIX_METHOD}`);

    const recalled = await new JsonlMemoryStore({
      memoryDir: tmpDir,
      kinds: ['lesson'],
    }).search({
      text: ROOT_CAUSE,
      metadata: { kinds: ['lesson'] },
    });
    expect(recalled).toHaveLength(1);
    expect(recalled[0].item.summary).toBe(rendered);
    expect(recalled[0].item.summary).toContain(ROOT_CAUSE);
  });
});
