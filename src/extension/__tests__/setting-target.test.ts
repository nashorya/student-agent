import { describe, expect, it } from 'vitest';
import { buildSettingTargetPrompt, parseSettingTargetAnswer } from '../setting-target.js';

describe('setting target prompt', () => {
  it('keeps the menu separate from the interactive prompt line', () => {
    const prompt = buildSettingTargetPrompt();

    expect(prompt.menu).toBe([
      '设置项：',
      '  [1] 模型 Provider / API Key',
      '  [2] 向量模型',
      '  [q] 取消',
    ].join('\n'));
    expect(prompt.menu).not.toMatch(/^\s*\d+[.)]\s/m);
    expect(prompt.question).toBe('选择 [1]: ');
    expect(prompt.question).not.toContain('\n');
  });

  it('parses the selected setting target', () => {
    expect(parseSettingTargetAnswer('')).toBe('model');
    expect(parseSettingTargetAnswer('1')).toBe('model');
    expect(parseSettingTargetAnswer('2')).toBe('embedding');
    expect(parseSettingTargetAnswer('向量模型')).toBe('embedding');
    expect(parseSettingTargetAnswer('q')).toBe('cancel');
  });
});
