import { describe, expect, it } from 'vitest';
import { sessionEntriesToSelectItems } from '../session-picker.js';

describe('sessionEntriesToSelectItems', () => {
  it('puts id only in value, not label/description', () => {
    const id = 'session_20260812T000000Z_abc123';
    const items = sessionEntriesToSelectItems(
      [{
        id,
        name: 'refactor auth',
        updated_at: '2026-08-12T09:00:00.000Z',
        message_count: 4,
        preview: '继续改登录',
      }],
      id,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.value).toBe(id);
    expect(items[0]?.label).toBe('refactor auth');
    expect(items[0]?.description).toContain('current');
    expect(items[0]?.description).toContain('继续改登录');
    expect(items[0]?.label).not.toContain(id);
    expect(items[0]?.description).not.toContain(id);
  });

  it('falls back to untitled when name empty', () => {
    const items = sessionEntriesToSelectItems([{
      id: 'session_x',
      name: '  ',
      updated_at: '2026-08-12T09:00:00.000Z',
      message_count: 0,
      preview: '',
    }]);
    expect(items[0]?.label).toBe('untitled');
  });
});
