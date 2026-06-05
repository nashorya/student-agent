import { describe, expect, it } from 'vitest';
import { formatSettingsPromptPrefix } from '../components/InputLine.js';

describe('InputLine settings prompt layout', () => {
  it('renders the settings question and input marker as one prompt prefix', () => {
    expect(formatSettingsPromptPrefix('\n  选择 Provider [2]: ')).toBe('选择 Provider [2]: > ');
  });
});
