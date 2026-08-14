import { describe, expect, it } from 'vitest';
import {
  auditCitedEvidence,
  findCausalPair,
} from '../causal-pair.js';

const cited = {
  errorToolCallId: 'err_1',
  fixToolCallIds: ['fix_1'],
  verificationToolCallId: 'verify_1',
};

describe('auditCitedEvidence', () => {
  it('accepts a cited error → fix → green verification triple', () => {
    const result = auditCitedEvidence([
      { toolCallId: 'err_1', kind: 'tool_error', isError: true },
      { toolCallId: 'fix_1', kind: 'tool_call', name: 'edit' },
      { toolCallId: 'verify_1', kind: 'tool_call', exitCode: 0 },
    ], cited);
    expect(result).toEqual({ ok: true });
  });

  it('resolves ids from id, metadata.evidenceRef, and nested data', () => {
    expect(auditCitedEvidence([
      { id: 'err_1', kind: 'tool_error', isError: true },
      { id: 'fix_1', kind: 'tool_call' },
      { id: 'verify_1', reward: 1 },
    ], cited)).toEqual({ ok: true });

    expect(auditCitedEvidence([
      { metadata: { evidenceRef: 'err_1' }, kind: 'tool_error', isError: true },
      { metadata: { evidenceRef: 'fix_1' }, kind: 'tool_call' },
      { metadata: { evidenceRef: 'verify_1' }, exitCode: 0 },
    ], cited)).toEqual({ ok: true });

    expect(auditCitedEvidence([
      { line: 0, data: { toolCallId: 'err_1', kind: 'tool_error', isError: true } },
      { line: 1, data: { toolCallId: 'fix_1', kind: 'tool_call' } },
      { line: 2, data: { toolCallId: 'verify_1', exitCode: 0 } },
    ], cited)).toEqual({ ok: true });

    expect(auditCitedEvidence([
      { data: { id: 'err_1', type: 'tool_error' } },
      { data: { id: 'fix_1', type: 'tool_call' } },
      { data: { id: 'verify_1', verifier: { reward: 1 } } },
    ], cited)).toEqual({ ok: true });

    expect(auditCitedEvidence([
      { data: { metadata: { evidenceRef: 'err_1' }, kind: 'tool_error', isError: true } },
      { data: { metadata: { evidenceRef: 'fix_1' }, kind: 'tool_call' } },
      { data: { metadata: { evidenceRef: 'verify_1' }, exit_code: 0 } },
    ], cited)).toEqual({ ok: true });
  });

  it('fails when fixToolCallIds is empty', () => {
    const result = auditCitedEvidence([
      { toolCallId: 'err_1', kind: 'tool_error', isError: true },
      { toolCallId: 'verify_1', exitCode: 0 },
    ], { ...cited, fixToolCallIds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });

  it('fails when any cited id is missing', () => {
    const events = [
      { toolCallId: 'err_1', kind: 'tool_error', isError: true },
      { toolCallId: 'fix_1', kind: 'tool_call' },
      { toolCallId: 'verify_1', exitCode: 0 },
    ];
    expect(auditCitedEvidence(events, { ...cited, errorToolCallId: 'missing_err' }).ok).toBe(false);
    expect(auditCitedEvidence(events, { ...cited, fixToolCallIds: ['missing_fix'] }).ok).toBe(false);
    expect(auditCitedEvidence(events, { ...cited, verificationToolCallId: 'missing_verify' }).ok).toBe(false);
  });

  it('fails when the cited error event exists but is not an error', () => {
    const result = auditCitedEvidence([
      { toolCallId: 'err_1', kind: 'tool_call' },
      { toolCallId: 'fix_1', kind: 'tool_call' },
      { toolCallId: 'verify_1', exitCode: 0 },
    ], cited);
    expect(result.ok).toBe(false);
  });

  it('fails when the cited verification event exists but is not green', () => {
    const result = auditCitedEvidence([
      { toolCallId: 'err_1', kind: 'tool_error', isError: true },
      { toolCallId: 'fix_1', kind: 'tool_call' },
      { toolCallId: 'verify_1', kind: 'tool_call', exitCode: 1 },
    ], cited);
    expect(result.ok).toBe(false);
  });

  it('treats a cited fix id as present even when the event is not a tool_call', () => {
    const result = auditCitedEvidence([
      { toolCallId: 'err_1', kind: 'tool_error', isError: true },
      { toolCallId: 'fix_1', kind: 'note', summary: 'applied copy instead of fill' },
      { toolCallId: 'verify_1', exitCode: 0 },
    ], cited);
    expect(result).toEqual({ ok: true });
  });
});

describe('findCausalPair (unchanged first-error search)', () => {
  it('still binds the first error, not a later one', () => {
    const pair = findCausalPair([
      { kind: 'note' },
      { kind: 'tool_error', isError: true },
      { kind: 'tool_call', name: 'edit' },
      { kind: 'tool_error', isError: true },
      { kind: 'tool_call', name: 'bash' },
      { kind: 'verification', exitCode: 0 },
    ]);
    expect(pair).toMatchObject({
      errorIndex: 1,
      streamVerified: true,
      provisional: false,
    });
    expect(pair?.operationIndices).toContain(2);
  });
});
