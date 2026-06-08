import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readEventsJsonl } from '../events-jsonl.js';
import { normalizeTraceEvent } from '../trace-event.js';
import { gradeEventsJsonl, gradeTraceEvents } from '../trace-grader.js';

describe('Trace Grader v0', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'trace-grader-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads JSONL events and ignores blank lines', async () => {
    const path = join(tmpDir, 'events.jsonl');
    await writeFile(path, '{"type":"tool_call"}\n\n{"event":"done"}\n', 'utf-8');

    await expect(readEventsJsonl(path)).resolves.toEqual([
      { type: 'tool_call' },
      { event: 'done' },
    ]);
  });

  it('throws invalid JSONL errors with line numbers', async () => {
    const path = join(tmpDir, 'events.jsonl');
    await writeFile(path, '{"type":"ok"}\nnot-json\n', 'utf-8');

    await expect(readEventsJsonl(path)).rejects.toThrow(/Invalid JSONL at line 2:/u);
  });

  it('normalizes loose trace event field names', () => {
    expect(normalizeTraceEvent({
      event: 'tool_result',
      tool_name: 'apply_patch',
      cmd: 'npx vitest run',
      path: 'src/app.ts',
      text: 'patched',
    })).toMatchObject({
      type: 'tool_result',
      toolName: 'apply_patch',
      command: 'npx vitest run',
      filePath: 'src/app.ts',
      message: 'patched',
    });
    expect(normalizeTraceEvent({
      kind: 'tool_call',
      data: { toolName: 'read_file' },
      input: { command: 'npm test', path: 'src/index.ts' },
      payload: { message: 'read complete' },
    })).toMatchObject({
      type: 'tool_call',
      toolName: 'read_file',
      command: 'npm test',
      filePath: 'src/index.ts',
      message: 'read complete',
    });
    expect(normalizeTraceEvent({
      name: 'assistant_message',
      tool: 'bash',
      args: { command: 'pnpm test', path: 'package.json' },
      payload: { content: 'all tests pass' },
    })).toMatchObject({
      type: 'assistant_message',
      toolName: 'bash',
      command: 'pnpm test',
      filePath: 'package.json',
      content: 'all tests pass',
    });
    expect(normalizeTraceEvent({ unknown: true })).toMatchObject({
      type: '',
      raw: { unknown: true },
    });
  });

  it('fails an empty trace on required tool, file change, and validation checks', () => {
    const result = gradeTraceEvents([]);

    expect(result.status).toBe('fail');
    expect(result.summary).toMatchObject({
      toolCallCount: 0,
      writeToolCallCount: 0,
      validationCommandCount: 0,
      hasFileChangeSignal: false,
      hasFinalSuccessClaim: false,
    });
    expect(checkStatus(result, 'tool_calls_present')).toBe('fail');
    expect(checkStatus(result, 'file_changes_present')).toBe('fail');
    expect(checkStatus(result, 'validation_present')).toBe('fail');
  });

  it('fails fake success claims without tool calls', () => {
    const result = gradeTraceEvents([
      { type: 'assistant_message', message: '完成了，all tests pass' },
    ]);

    expect(result.status).toBe('fail');
    expect(result.summary.hasFinalSuccessClaim).toBe(true);
    expect(checkStatus(result, 'fake_success_without_tools')).toBe('fail');
  });

  it('passes tool presence for read tools but fails file changes without writes', () => {
    const result = gradeTraceEvents([
      { type: 'tool_call', toolName: 'read_file' },
    ], { requireValidationCommand: false });

    expect(result.summary).toMatchObject({
      toolCallCount: 1,
      readToolCallCount: 1,
      writeToolCallCount: 0,
    });
    expect(checkStatus(result, 'tool_calls_present')).toBe('pass');
    expect(checkStatus(result, 'file_changes_present')).toBe('fail');
  });

  it('passes file change checks for write tools and collects touched files', () => {
    const result = gradeTraceEvents([
      { type: 'tool_call', toolName: 'apply_patch', args: { path: 'src/app.ts' } },
      { type: 'tool_result', toolName: 'write_file', input: { path: 'src/app.ts' } },
    ], { requireValidationCommand: false });

    expect(result.summary.writeToolCallCount).toBe(2);
    expect(result.summary.hasFileChangeSignal).toBe(true);
    expect(result.summary.touchedFiles).toEqual(['src/app.ts']);
    expect(checkStatus(result, 'file_changes_present')).toBe('pass');
  });

  it('passes validation checks when validation commands are present', () => {
    const result = gradeTraceEvents([
      { type: 'tool_call', toolName: 'bash', command: 'npx tsc --noEmit' },
    ], { requireFileChange: false });

    expect(result.summary.validationCommandCount).toBe(1);
    expect(checkStatus(result, 'validation_present')).toBe('pass');
  });

  it('passes when trace has write and validation evidence', () => {
    const result = gradeTraceEvents([
      { type: 'tool_call', toolName: 'apply_patch', filePath: 'src/a.ts' },
      { type: 'tool_call', toolName: 'bash', command: 'npx vitest run' },
    ]);

    expect(result.status).toBe('pass');
    expect(result.summary).toMatchObject({
      toolCallCount: 2,
      writeToolCallCount: 1,
      validationCommandCount: 1,
      hasFileChangeSignal: true,
    });
  });

  it('passes final success claims when write and validation support them', () => {
    const result = gradeTraceEvents([
      { type: 'tool_call', toolName: 'apply_patch', path: 'src/a.ts' },
      { type: 'tool_call', toolName: 'bash', command: 'npm test' },
      { type: 'assistant_message', content: 'done, tests green' },
    ]);

    expect(result.status).toBe('pass');
    expect(result.summary.hasFinalSuccessClaim).toBe(true);
    expect(checkStatus(result, 'fake_success_without_tools')).toBe('pass');
    expect(checkStatus(result, 'fake_success_without_validation')).toBe('pass');
  });

  it('fails or warns on success claims without validation based on allowWarnings', () => {
    const failResult = gradeTraceEvents([
      { type: 'tool_call', toolName: 'apply_patch', path: 'src/a.ts' },
      { type: 'assistant_message', message: '完成了' },
    ]);
    const warningResult = gradeTraceEvents([
      { type: 'tool_call', toolName: 'apply_patch', path: 'src/a.ts' },
      { type: 'assistant_message', message: '完成了' },
    ], { allowWarnings: true });

    expect(checkStatus(failResult, 'fake_success_without_validation')).toBe('fail');
    expect(failResult.status).toBe('fail');
    expect(checkStatus(warningResult, 'fake_success_without_validation')).toBe('warning');
    expect(warningResult.status).toBe('warning');
  });

  it('supports disabling file change and validation requirements', () => {
    const result = gradeTraceEvents([
      { type: 'tool_call', toolName: 'read_file' },
    ], {
      requireFileChange: false,
      requireValidationCommand: false,
    });

    expect(result.status).toBe('pass');
    expect(checkStatus(result, 'file_changes_present')).toBe('pass');
    expect(checkStatus(result, 'validation_present')).toBe('pass');
  });

  it('grades events from an events.jsonl file', async () => {
    const path = join(tmpDir, 'events.jsonl');
    await writeFile(path, [
      JSON.stringify({ type: 'tool_call', toolName: 'apply_patch', path: 'src/a.ts' }),
      JSON.stringify({ type: 'tool_call', toolName: 'bash', command: 'yarn test' }),
      '',
    ].join('\n'), 'utf-8');

    await expect(gradeEventsJsonl(path)).resolves.toMatchObject({
      status: 'pass',
      summary: {
        toolCallCount: 2,
        writeToolCallCount: 1,
        validationCommandCount: 1,
        touchedFiles: ['src/a.ts'],
      },
    });
  });
});

function checkStatus(
  result: ReturnType<typeof gradeTraceEvents>,
  id: string,
): string | undefined {
  return result.checks.find((check) => check.id === id)?.status;
}
