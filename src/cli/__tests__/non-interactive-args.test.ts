import { describe, expect, it } from 'vitest';
import { parseNonInteractiveArgs } from '../non-interactive-args.js';

describe('parseNonInteractiveArgs', () => {
  it('returns interactive mode when no args are provided', () => {
    expect(parseNonInteractiveArgs([])).toEqual({ mode: 'interactive' });
  });

  it('parses an inline prompt', () => {
    expect(parseNonInteractiveArgs([
      '--prompt',
      'do x',
      '--run-mode',
      'eval',
      '--memory-dir',
      '/tmp/task-memory',
    ])).toEqual({
      mode: 'prompt',
      prompt: 'do x',
      runMode: 'eval',
      memoryDir: '/tmp/task-memory',
    });
  });

  it('parses a summary path for one-shot mode', () => {
    expect(parseNonInteractiveArgs(['--prompt', 'do x', '--json-summary', '/tmp/summary.json'])).toEqual({
      mode: 'prompt',
      prompt: 'do x',
      jsonSummaryPath: '/tmp/summary.json',
    });
  });

  it('parses a prompt file path', () => {
    expect(parseNonInteractiveArgs(['--prompt-file', '/tmp/task.md'])).toEqual({
      mode: 'prompt-file',
      promptFile: '/tmp/task.md',
    });
  });

  it('rejects missing prompt values', () => {
    expect(parseNonInteractiveArgs(['--prompt'])).toEqual({
      mode: 'error',
      message: '--prompt requires a value',
    });
    expect(parseNonInteractiveArgs(['--prompt-file'])).toEqual({
      mode: 'error',
      message: '--prompt-file requires a path',
    });
    expect(parseNonInteractiveArgs(['--json-summary'])).toEqual({
      mode: 'error',
      message: '--json-summary requires a path',
    });
  });

  it('rejects duplicate prompt sources', () => {
    expect(parseNonInteractiveArgs([
      '--prompt',
      'do x',
      '--prompt-file',
      '/tmp/task.md',
    ])).toEqual({
      mode: 'error',
      message: 'Use either --prompt or --prompt-file, not both',
    });
  });

  it('rejects unknown arguments', () => {
    expect(parseNonInteractiveArgs(['--unknown'])).toEqual({
      mode: 'error',
      message: 'Unknown argument: --unknown',
    });
  });

  it('rejects a summary path without a prompt source', () => {
    expect(parseNonInteractiveArgs(['--json-summary', '/tmp/summary.json'])).toEqual({
      mode: 'error',
      message: '--json-summary requires --prompt or --prompt-file',
    });
  });

  it('rejects invalid run modes and context flags without a prompt', () => {
    expect(parseNonInteractiveArgs(['--prompt', 'do x', '--run-mode', 'batch'])).toEqual({
      mode: 'error',
      message: '--run-mode must be interactive or eval',
    });
    expect(parseNonInteractiveArgs(['--run-mode', 'eval'])).toEqual({
      mode: 'error',
      message: '--run-mode requires --prompt or --prompt-file',
    });
    expect(parseNonInteractiveArgs(['--memory-dir', '/tmp/task-memory'])).toEqual({
      mode: 'error',
      message: '--memory-dir requires --prompt or --prompt-file',
    });
  });
});
