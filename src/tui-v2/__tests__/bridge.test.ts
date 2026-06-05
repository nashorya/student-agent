import { describe, expect, it } from 'vitest';
import { createTUIV2BridgeForTest } from '../bridge.js';

describe('TUI v2 bridge', () => {
  it('commits assistant stream exactly once', () => {
    const harness = createTUIV2BridgeForTest();

    harness.bridge.addMessage('assistant', '');
    harness.bridge.updateLastMessage('hello');
    harness.bridge.endAssistantMessage();

    expect(harness.state().transcript.messages).toHaveLength(1);
    expect(harness.state().transcript.messages[0].content).toBe('hello');
    expect(harness.state().streaming).toBeNull();
  });

  it('can discard an intermediate assistant preview before committing the final stream', () => {
    const harness = createTUIV2BridgeForTest();

    harness.bridge.addMessage('assistant', '');
    harness.bridge.updateLastMessage('A');
    harness.bridge.discardAssistantMessage();
    harness.bridge.addMessage('assistant', '');
    harness.bridge.updateLastMessage('B');
    harness.bridge.endAssistantMessage();

    expect(harness.state().transcript.messages).toHaveLength(1);
    expect(harness.state().transcript.messages[0]).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'B' }),
    );
    expect(harness.state().streaming).toBeNull();
  });

  it('does not commit an empty assistant stream', () => {
    const harness = createTUIV2BridgeForTest();

    harness.bridge.addMessage('assistant', '');
    harness.bridge.endAssistantMessage();

    expect(harness.state().transcript.messages).toEqual([]);
    expect(harness.state().streaming).toBeNull();
  });

  it('clear resets screen state through bridge', () => {
    const harness = createTUIV2BridgeForTest();

    harness.bridge.addMessage('user', 'hello');
    harness.bridge.setStatus('busy');
    harness.bridge.dispatch({ type: 'SET_INPUT', value: 'draft', cursor: 5 });
    harness.bridge.clear();

    expect(harness.state().transcript.messages).toEqual([]);
    expect(harness.state().status.transient).toBe('');
    expect(harness.state().input.value).toBe('');
  });

  it('idle task updates clear transient status instead of rendering a bare idle line', () => {
    const harness = createTUIV2BridgeForTest();

    harness.bridge.setStatus('busy');
    harness.bridge.updateTaskStatus({ state: 'idle' });

    expect(harness.state().status.transient).toBe('');
  });

  it('routes structured task updates into the task panel without setting transient status', () => {
    const harness = createTUIV2BridgeForTest();

    harness.bridge.updateTaskStatus({
      name: '重做 TUI',
      phaseIndex: 1,
      totalPhases: 4,
      workflowStatus: 'executing',
      retryCount: 2,
      toolCallCount: 3,
      elapsedMs: 2500,
      state: 'running',
    });

    expect(harness.state().taskPanel).toEqual(expect.objectContaining({
      name: '重做 TUI',
      phaseIndex: 1,
      totalPhases: 4,
      workflowStatus: 'executing',
      retryCount: 2,
      toolCallCount: 3,
      state: 'running',
    }));
    expect(harness.state().status.transient).toBe('');
    expect(harness.state().transcript.messages).toEqual([]);
  });
});
