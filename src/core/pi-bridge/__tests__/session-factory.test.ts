import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '@mariozechner/pi-agent-core';
import { registerFauxProvider, streamSimple } from '@mariozechner/pi-ai';
import { applyLlmRequestLimits, createStudentSession } from '../session-factory.js';

const registrations: Array<{ unregister: () => void }> = [];

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.unregister();
  }
});

describe('createStudentSession', () => {
  it('injects memory prompt through Pi resource loader lifecycle', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'student-session-test-'));
    const faux = registerFauxProvider();
    registrations.push(faux);

    try {
      const { session } = await createStudentSession({
        cwd,
        model: faux.getModel(),
        hooks: {
          buildMemoryPrompt: async () => 'MEMORY_SENTINEL',
        },
        piOptions: {
          agentDir: join(cwd, '.pi'),
        },
      });

      expect(session.systemPrompt).toContain('MEMORY_SENTINEL');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('registers apply_patch as an active custom tool', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'student-session-tools-test-'));
    const faux = registerFauxProvider();
    registrations.push(faux);

    try {
      const { session } = await createStudentSession({
        cwd,
        model: faux.getModel(),
        hooks: {},
        piOptions: {
          agentDir: join(cwd, '.pi'),
        },
      });

      expect(session.getActiveToolNames()).toEqual(expect.arrayContaining([
        'list_files',
        'glob',
        'search_files',
        'read_many',
        'apply_patch',
      ]));
      expect(session.getToolDefinition('bash')?.description).toContain('default timeout of 120 seconds');
      expect(session.getToolDefinition('bash')?.promptGuidelines?.join('\n')).toContain('Do not use bash for ls/find/grep/rg/cat/head/tail');
      expect(session.systemPrompt).toContain('apply_patch');
      expect(session.systemPrompt).toContain('search_files');
      expect(session.systemPrompt).toContain('Bash commands time out after 120 seconds');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('injects LLM request limits into the agent stream function', async () => {
    const faux = registerFauxProvider();
    registrations.push(faux);

    let observedOptions: {
      timeoutMs?: number;
      maxTokens?: number;
      maxRetries?: number;
      maxRetryDelayMs?: number;
    } | null = null;
    const agent = new Agent({
      streamFn: (model, context, options) => {
        observedOptions = {
          timeoutMs: options?.timeoutMs,
          maxTokens: options?.maxTokens,
          maxRetries: options?.maxRetries,
          maxRetryDelayMs: options?.maxRetryDelayMs,
        };
        return streamSimple(model, context, options);
      },
    });

    applyLlmRequestLimits(agent, {
      timeoutMs: 120_000,
      maxTokens: 4096,
      maxRetries: 1,
      maxRetryDelayMs: 30_000,
    });

    const stream = await agent.streamFn(faux.getModel(), {
      systemPrompt: '',
      messages: [],
      tools: [],
    });
    await stream.result();

    expect(observedOptions).toEqual({
      timeoutMs: 120_000,
      maxTokens: 4096,
      maxRetries: 1,
      maxRetryDelayMs: 30_000,
    });
  });
});
