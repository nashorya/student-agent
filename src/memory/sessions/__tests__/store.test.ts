import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore, formatSessionExitHint } from '../store.js';

describe('SessionStore', () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sa-sessions-'));
    store = new SessionStore(dir);
  });

  afterEach(() => {
    // tmp dirs cleaned by OS; no singleton to reset
  });

  it('creates a new session file under memory/sessions', async () => {
    const session = await store.createSession({ cwd: '/proj' });
    expect(session.id).toMatch(/^session_/);
    const raw = await readFile(join(dir, 'sessions', `${session.id}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.cwd).toBe('/proj');
    expect(parsed.messages).toEqual([]);
  });

  it('persists messages and updates the index', async () => {
    const session = await store.createSession();
    await store.saveMessages([
      { id: 'u1', kind: 'user', content: '制定一个计划', timestamp: 1 },
      { id: 'a1', kind: 'assistant', content: '好的', timestamp: 2 },
    ]);
    const reloaded = await store.loadSession(session.id);
    expect(reloaded?.messages).toHaveLength(2);
    expect(reloaded?.name).toContain('制定');
    const listed = await store.listSessions();
    expect(listed[0]?.id).toBe(session.id);
    expect(listed[0]?.message_count).toBe(2);
  });

  it('resolves by id prefix and by name', async () => {
    const a = await store.createSession({ name: 'alpha-plan' });
    await store.saveMessages([{ id: 'u1', kind: 'user', content: 'alpha-plan hello', timestamp: 1 }]);
    // rename happens via saveMessages from first user line if untitled; force:
    await store.rename('alpha-plan');

    const byPrefix = await store.resolveSession(a.id.slice(0, 18));
    expect(byPrefix?.id).toBe(a.id);

    const byName = await store.resolveSession('alpha-plan');
    expect(byName?.id).toBe(a.id);
  });

  it('keeps old session files when creating a new one', async () => {
    const first = await store.createSession();
    await store.saveMessages([{ id: 'u1', kind: 'user', content: 'first', timestamp: 1 }]);
    const second = await store.createSession();
    expect(second.id).not.toBe(first.id);
    const stillThere = await store.loadSession(first.id);
    expect(stillThere?.messages[0]?.content).toBe('first');
  });

  it('binds task_id', async () => {
    await store.createSession();
    await store.bindTask('task_123');
    expect(store.currentSession?.task_id).toBe('task_123');
  });

  it('formatList hides session ids (Codex-style)', async () => {
    const session = await store.createSession({ name: 'demo-plan' });
    await store.saveMessages([{ id: 'u1', kind: 'user', content: 'hello world', timestamp: 1 }]);
    const listed = await store.listSessions();
    const text = store.formatList(listed, session.id);
    expect(text).toContain('demo-plan');
    expect(text).not.toContain(session.id);
    expect(text).toMatch(/●|msgs/);
  });

  it('formatSessionExitHint prints id for CLI only', () => {
    expect(formatSessionExitHint(null)).toBeNull();
    const hint = formatSessionExitHint({ id: 'session_abc', name: 'demo' });
    expect(hint).toContain('session_abc');
    expect(hint).toContain('demo');
  });
});
