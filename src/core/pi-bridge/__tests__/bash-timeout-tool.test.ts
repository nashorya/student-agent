import { describe, expect, it } from 'vitest';
import type { BashOperations } from '@earendil-works/pi-coding-agent';
import { createStudentBashToolDefinition, DEFAULT_BASH_TIMEOUT_SECONDS } from '../bash-timeout-tool.js';

describe('createStudentBashToolDefinition', () => {
  it('applies a default timeout when the model omits one', async () => {
    let observedTimeout: number | undefined;
    const operations: BashOperations = {
      exec: async (_command, _cwd, options) => {
        observedTimeout = options.timeout;
        options.onData(Buffer.from('ok'));
        return { exitCode: 0 };
      },
    };
    const tool = createStudentBashToolDefinition('/tmp', { operations });

    await tool.execute('tool_1', { command: 'echo ok' }, undefined, undefined, undefined as never);

    expect(observedTimeout).toBe(DEFAULT_BASH_TIMEOUT_SECONDS);
  });

  it('keeps an explicit model-provided timeout', async () => {
    let observedTimeout: number | undefined;
    const operations: BashOperations = {
      exec: async (_command, _cwd, options) => {
        observedTimeout = options.timeout;
        return { exitCode: 0 };
      },
    };
    const tool = createStudentBashToolDefinition('/tmp', {
      defaultTimeoutSeconds: 120,
      operations,
    });

    await tool.execute('tool_1', { command: 'sleep 1', timeout: 5 }, undefined, undefined, undefined as never);

    expect(observedTimeout).toBe(5);
  });
});
