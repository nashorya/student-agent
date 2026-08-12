import { describe, expect, it, vi } from 'vitest';
import { createBufferedPromptLog } from '../prompt-log.js';

describe('createBufferedPromptLog', () => {
  it('flushes accumulated setup logs separately before prompting', async () => {
    const writeLog = vi.fn();
    const prompt = vi.fn(async (question: string) => `answer:${question}`);
    const adapter = createBufferedPromptLog({ writeLog, prompt });

    adapter.log('需要配置 LLM Provider 和 API Key。');
    adapter.log('  1) anthropic');
    adapter.log('  2) deepseek');

    await expect(adapter.prompt('选择 Provider [1]: ')).resolves.toBe('answer:选择 Provider [1]: ');

    expect(writeLog).toHaveBeenCalledWith([
      '需要配置 LLM Provider 和 API Key。',
      '  1) anthropic',
      '  2) deepseek',
    ].join('\n'));
    expect(prompt).toHaveBeenCalledWith('选择 Provider [1]: ');
  });

  it('does not flush blank logs', async () => {
    const writeLog = vi.fn();
    const prompt = vi.fn(async () => '');
    const adapter = createBufferedPromptLog({ writeLog, prompt });

    adapter.log('');
    adapter.log('   ');
    await adapter.prompt('继续? ');

    expect(writeLog).not.toHaveBeenCalled();
  });
});
