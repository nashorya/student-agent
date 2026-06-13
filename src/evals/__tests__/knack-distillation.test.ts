import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deduplicateCandidates,
  distillResults,
  distillRunEvents,
  parseJsonLines,
} from '../knack-distillation.js';

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
      fix_summary: 'Tool sequence: read -> edit -> bash.',
      verified_fix: expect.stringContaining('read -> edit -> bash'),
      evidence_task: 'owner__repo-123',
      evidence_turns: [2, 5],
      compression_level: 'knack',
      confidence: 'verified',
      reuse_count: 0,
      injected_count: 0,
      last_succeeded_task: null,
      last_injected_task: null,
      unit_test: 'Verified by exit 0.',
    });
  });

  it.each([
    ['The bug is the parser drops escaped delimiters. The fix preserves them.', 'the parser drops escaped delimiters.'],
    ['Root cause: the cache key omits the locale. Added the locale to the key.', 'the cache key omits the locale.'],
    ['The issue is an off-by-one boundary check. Updated the comparison.', 'an off-by-one boundary check.'],
    ['The bug is clear. chararray.replace returns a copy. Assigned it back.', 'chararray.replace returns a copy.'],
    ['The bug is clear: output_field.replace returns a copy. Assigned it back.', 'output_field.replace returns a copy.'],
  ])('prefers the verified fix cause marker for the symptom', (finalSummary, expectedSymptom) => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"generic command failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary,
    })?.symptom).toBe(expectedSymptom);
  });

  it.each([
    ['The fix is assign the replacement back. Ignore this. Fix: lower priority.', 'assign the replacement back.'],
    ['Fix: validate every changed line. The solution is inspect manually.', 'validate every changed line.'],
    ['The solution is preserve the existing matrix values. Done.', 'preserve the existing matrix values.'],
    ['No explicit marker appears here. The rest is audit detail.', 'Tool sequence: edit.'],
  ])('extracts fix_summary by marker priority', (finalSummary, expectedFixSummary) => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"generic command failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary,
    })?.fix_summary).toBe(expectedFixSummary);
  });

  it('deduplicates normalized symptoms and keeps the shorter evidence span', () => {
    const longer = distillRunEvents({
      events: parseJsonLines([
        '{"kind":"tool_error","toolName":"bash","summary":"Parser ERROR: escaped delimiters are dropped!"}',
        '{"kind":"tool_call","toolName":"read","summary":"inspect"}',
        '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
        '{"kind":"tool_call","toolName":"bash","summary":"verify"}',
        '{"kind":"verifier","reward":1}',
      ].join('\n')),
      evidenceTask: 'owner__repo-older',
      repo: 'owner/repo',
    });
    const shorter = distillRunEvents({
      events: parseJsonLines([
        '{"kind":"tool_error","toolName":"bash","summary":"parser error escaped delimiters are dropped"}',
        '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
        '{"kind":"verifier","reward":1}',
      ].join('\n')),
      evidenceTask: 'owner__repo-newer',
      repo: 'owner/repo',
    });

    expect(longer?.dedup_key).toBe(shorter?.dedup_key);
    expect(deduplicateCandidates([longer!, shorter!])).toEqual([shorter]);
  });

  it.each([
    [
      'The bug is clear. The `replace` call does not reassign the result.',
      'The bug is clear: `output_field.replace(...)` returns a new array but the result is discarded.',
    ],
    [
      'I can see the bug. In `_arithmetic_mask`, `operand.mask` is None and falls through to `handle_mask`.',
      'Now I can see the issue. In `_arithmetic_mask`, the else branch does not handle `operand.mask is None`.',
    ],
  ])('fingerprints equivalent code-root causes consistently', (firstSummary, secondSummary) => {
    const makeCandidate = (finalSummary: string) => distillRunEvents({
      events: parseJsonLines([
        '{"kind":"tool_error","toolName":"bash","summary":"environment failed"}',
        '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
        '{"kind":"verifier","reward":1}',
      ].join('\n')),
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary,
    });

    expect(makeCandidate(firstSummary)?.dedup_key).toBe(makeCandidate(secondSummary)?.dedup_key);
  });

  it('does not treat an embedded phrase as a fix marker', () => {
    const candidate = distillRunEvents({
      events: parseJsonLines([
        '{"kind":"tool_error","toolName":"bash","summary":"tests failed"}',
        '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
        '{"kind":"verifier","reward":1}',
      ].join('\n')),
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary: 'Let me verify the fix is logically correct. No explicit fix marker follows.',
    });

    expect(candidate?.fix_summary).toBe('Tool sequence: edit.');
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
