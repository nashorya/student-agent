import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distillResults, distillRunEvents, parseJsonLines } from '../knack-distillation.js';

describe('knack distillation', () => {
  it('extracts the operation sequence from the first error through verified success', () => {
    const events = parseJsonLines([
      '{"kind":"tool_call","toolName":"bash","summary":"run tests"}',
      '{"kind":"tool_error","toolName":"bash","summary":"AssertionError: expected 2, got 1"}',
      '{"kind":"tool_call","toolName":"read","summary":"inspect implementation"}',
      '{"kind":"tool_call","toolName":"edit","summary":"patch implementation"}',
      '{"kind":"tool_call","toolName":"bash","summary":"rerun tests"}',
      '{"kind":"verification","exitCode":0,"summary":"tests passed"}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      verification: 'exit 0',
      finalSummary: 'Updated the boundary condition and reran the focused test.',
    })).toMatchObject({
      repo: 'owner/repo',
      symptom: 'AssertionError: expected 2, got 1',
      verified_fix: expect.stringContaining('read -> edit -> bash'),
      evidence_task: 'owner__repo-123',
      evidence_turns: [2, 5],
      compression_level: 'knack',
      confidence: 'verified',
      reuse_count: 0,
      unit_test: 'Verified by exit 0.',
    });
  });

  it('does not emit a candidate without exit 0 or verifier reward 1', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"tests failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"unverified edit"}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-456',
      repo: 'owner/repo',
    })).toBeNull();
  });

  it('accepts verifier reward 1 as a successful terminator', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"tests failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-789',
      repo: 'owner/repo',
    })?.unit_test).toBe('Verified by verifier reward=1.');
  });

  it('links run archives to their task and resolved harness result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knack-distillation-'));
    const memoryDir = join(root, 'tier-b-on-memory');
    const runDir = join(memoryDir, 'runs', 'run_1');
    const resultDir = join(root, 'tier-b-on-123');
    const output = join(root, 'candidate-knacks.json');
    try {
      await mkdir(runDir, { recursive: true });
      await mkdir(resultDir, { recursive: true });
      await writeFile(join(memoryDir, 'tasks.json'), JSON.stringify({
        tasks: [{ id: 'task_1', name: 'Eval task: SWE-bench owner__repo-123' }],
      }));
      await writeFile(join(runDir, 'outcome.json'), JSON.stringify({
        taskId: 'task_1',
        finalSummary: 'Patched the parser and reran its tests.',
      }));
      await writeFile(join(runDir, 'events.jsonl'), [
        '{"kind":"tool_error","toolName":"bash","summary":"parser test failed"}',
        '{"kind":"tool_call","toolName":"edit","summary":"patch parser"}',
        '{"kind":"tool_call","toolName":"bash","summary":"rerun parser tests"}',
      ].join('\n'));
      await writeFile(join(resultDir, 'metadata.json'), JSON.stringify({
        studentMemoryDir: memoryDir,
        instances: [{ instanceId: 'owner__repo-123' }],
      }));
      await writeFile(join(resultDir, 'harness-report.json'), JSON.stringify({
        resolved_ids: ['owner__repo-123'],
      }));

      const candidates = await distillResults(root, output);

      expect(candidates).toHaveLength(1);
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(candidates);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
