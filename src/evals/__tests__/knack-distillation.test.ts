import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deduplicateCandidates,
  distillResults,
  distillRunEvents,
  extractSymptom,
  isBlacklistedFix,
  isInformativeSymptom,
  parseJsonLines,
  softSummarize,
} from '../knack-distillation.js';

describe('knack distillation', () => {
  it('extracts the operation sequence from the first error through verified success', () => {
    const events = parseJsonLines([
      '{"kind":"tool_call","toolName":"bash","summary":"run tests"}',
      '{"kind":"tool_error","toolName":"bash","summary":"AssertionError: expected 2, got 1"}',
      '{"kind":"tool_call","toolName":"read","summary":"inspect implementation"}',
      '{"kind":"tool_call","toolName":"edit","summary":"patch implementation"}',
      '{"kind":"tool_call","toolName":"bash","summary":"rerun tests"}',
      '{"kind":"verification","exitCode":0,"summary":"tests passed"}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      verification: 'exit 0',
      finalSummary: 'Updated the boundary condition and reran the focused test.',
    })).toMatchObject({
      repo: 'owner/repo',
      symptom: 'AssertionError: expected 2, got 1',
      // No fix marker and no code-bearing sentence → never invent tool-sequence prose.
      fix_summary: '',
      verified_fix: expect.stringContaining('read -> edit -> bash'),
      evidence_task: 'owner__repo-123',
      evidence_turns: [2, 5],
      compression_level: 'knack',
      confidence: 'candidate',
      reuse_count: 0,
      injected_count: 0,
      last_succeeded_task: null,
      last_injected_task: null,
      unit_test: 'Verified by exit 0. Fix not extracted.',
    });
  });

  it.each([
    ['The bug is the parser drops escaped delimiters. The fix preserves them.', 'the parser drops escaped delimiters.'],
    ['Root cause: the cache key omits the locale. Added the locale to the key.', 'the cache key omits the locale.'],
    ['The issue is an off-by-one boundary check. Updated the comparison.', 'an off-by-one boundary check.'],
    ['The bug is clear. chararray.replace returns a copy. Assigned it back.', 'chararray.replace returns a copy.'],
    ['The bug is clear: output_field.replace returns a copy. Assigned it back.', 'output_field.replace returns a copy.'],
  ])('prefers the verified fix cause marker for the symptom', (finalSummary, expectedSymptom) => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"generic command failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary,
    })?.symptom).toBe(expectedSymptom);
  });

  it.each([
    ['The fix is assign the replacement back. Ignore this. Fix: lower priority.', 'assign the replacement back.'],
    ['Fix: validate every changed line. The solution is inspect manually.', 'validate every changed line.'],
    ['The solution is preserve the existing matrix values. Done.', 'preserve the existing matrix values.'],
    ['No explicit marker appears here. The rest is audit detail.', ''],
  ])('extracts fix_summary by marker priority', (finalSummary, expectedFixSummary) => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"generic command failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary,
    })?.fix_summary).toBe(expectedFixSummary);
  });

  it('keeps marker-based fix_summary and verified confidence (no regression)', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"generic command failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary: 'The fix is to assign `output_field[:] = output_field.replace(...)`.',
    })).toMatchObject({
      fix_summary: 'to assign `output_field[:] = output_field.replace(...)`.',
      confidence: 'verified',
      unit_test: 'Verified by verifier reward=1.',
    });
  });

  it('degrades to empty fix_summary and candidate when no marker and no code sentence', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"generic command failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    const candidate = distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary: 'Everything looks fine after a careful review of the change.',
    });

    expect(candidate).toMatchObject({
      fix_summary: '',
      confidence: 'candidate',
      unit_test: 'Verified by verifier reward=1. Fix not extracted.',
    });
    expect(candidate?.fix_summary.startsWith('Tool sequence')).toBe(false);
  });

  it('uses the last code-bearing finalSummary sentence when markers are absent', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"generic command failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary:
        'Investigation complete. Accept `header_rows` in `RST.__init__` and reindex separators. Ready to ship.',
    })).toMatchObject({
      fix_summary: 'Accept `header_rows` in `RST.__init__` and reindex separators.',
      confidence: 'verified',
    });
  });

  it('deduplicates normalized symptoms and keeps the shorter evidence span', () => {
    const longer = distillRunEvents({
      events: parseJsonLines([
        '{"kind":"tool_error","toolName":"bash","summary":"Parser ERROR: escaped delimiters are dropped!"}',
        '{"kind":"tool_call","toolName":"read","summary":"inspect"}',
        '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
        '{"kind":"tool_call","toolName":"bash","summary":"verify"}',
        '{"kind":"verifier","reward":1}',
      ].join('\n')),
      evidenceTask: 'owner__repo-older',
      repo: 'owner/repo',
    });
    const shorter = distillRunEvents({
      events: parseJsonLines([
        '{"kind":"tool_error","toolName":"bash","summary":"parser error escaped delimiters are dropped"}',
        '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
        '{"kind":"verifier","reward":1}',
      ].join('\n')),
      evidenceTask: 'owner__repo-newer',
      repo: 'owner/repo',
    });

    expect(longer?.dedup_key).toBe(shorter?.dedup_key);
    expect(deduplicateCandidates([longer!, shorter!])).toEqual([shorter]);
  });

  it.each([
    [
      'The bug is clear. The `replace` call does not reassign the result.',
      'The bug is clear: `output_field.replace(...)` returns a new array but the result is discarded.',
    ],
    [
      'I can see the bug. In `_arithmetic_mask`, `operand.mask` is None and falls through to `handle_mask`.',
      'Now I can see the issue. In `_arithmetic_mask`, the else branch does not handle `operand.mask is None`.',
    ],
  ])('fingerprints equivalent code-root causes consistently', (firstSummary, secondSummary) => {
    const makeCandidate = (finalSummary: string) => distillRunEvents({
      events: parseJsonLines([
        '{"kind":"tool_error","toolName":"bash","summary":"environment failed"}',
        '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
        '{"kind":"verifier","reward":1}',
      ].join('\n')),
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary,
    });

    expect(makeCandidate(firstSummary)?.dedup_key).toBe(makeCandidate(secondSummary)?.dedup_key);
  });

  it('does not treat an embedded phrase as a fix marker', () => {
    const candidate = distillRunEvents({
      events: parseJsonLines([
        '{"kind":"tool_error","toolName":"bash","summary":"tests failed"}',
        '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
        '{"kind":"verifier","reward":1}',
      ].join('\n')),
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary: 'Let me verify the fix is logically correct. No explicit fix marker follows.',
    });

    expect(candidate?.fix_summary).toBe('');
    expect(candidate?.confidence).toBe('candidate');
  });

  it('does not emit a candidate without exit 0 or verifier reward 1', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"tests failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"unverified edit"}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-456',
      repo: 'owner/repo',
    })).toBeNull();
  });

  it('accepts verifier reward 1 as a successful terminator', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"tests failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'owner__repo-789',
      repo: 'owner/repo',
      finalSummary: 'The fix is restore the prior boundary.',
    })?.unit_test).toBe('Verified by verifier reward=1.');
  });

  it('skips low-info agent symptom and uses first substantial tool error (fidelity v2)', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"edit","summary":"Hashline: file changed since last read"}',
      '{"kind":"tool_error","toolName":"bash","summary":"AssertionError: expected D exponent in FITS field"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'astropy__astropy-6938',
      repo: 'astropy/astropy',
      finalSummary: 'The bug is confirmed. The fix is to assign replace result back.',
    })?.symptom).toBe('AssertionError: expected D exponent in FITS field');
  });

  it('prefers issue title from taskInstruction over agent fluff', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"edit","summary":"Hashline: stale tag"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    expect(distillRunEvents({
      events,
      evidenceTask: 'astropy__astropy-6938',
      repo: 'astropy/astropy',
      taskInstruction: [
        'Resolve this SWE-bench issue in the current repository.',
        'Instance: astropy__astropy-6938',
        '',
        'Possible bug in io.fits related to D exponents',
        'chararray.replace is not in-place.',
      ].join('\n'),
      finalSummary: 'The bug is confirmed. The fix is assign replace back.',
    })?.symptom).toBe('Possible bug in io.fits related to D exponents');
  });

  it('soft-limits long fix_summary at sentence end (fidelity v3 limits)', () => {
    const longTail = 'Keep the rest of the paragraph for context only and do not mid-cut. ';
    const finalSummary = `The fix is ${'Assign the replace result back to output_field so D exponents survive. '.repeat(3)}${longTail.repeat(5)}`;
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"generic command failed"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));

    const fix = distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary,
    })?.fix_summary ?? '';

    expect(fix.endsWith('.')).toBe(true);
    expect(fix.length).toBeLessThanOrEqual(800);
    expect(fix.includes('Assign the replace result')).toBe(true);
    expect(fix.length === 300 && !/[.!?]$/.test(fix)).toBe(false);
  });

  it('isInformativeSymptom rejects confirmed fluff', () => {
    expect(isInformativeSymptom('confirmed.')).toBe(false);
    expect(isInformativeSymptom('The issue is clear')).toBe(false);
    expect(isInformativeSymptom('AssertionError: matrix wrong')).toBe(true);
  });

  it('softSummarize extends to sentence end instead of chopping at soft limit', () => {
    const text = `${'word '.repeat(40)}Complete sentence ends here. Extra clause stays out if possible.`;
    const out = softSummarize(text, 300, 800);
    expect(out.endsWith('.')).toBe(true);
    expect(out.includes('Complete sentence ends here.')).toBe(true);
  });

  it('rejects three distortion types: tool-sequence, fluff, and test-report', () => {
    const base = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"AssertionError: dim mismatch"}',
      '{"kind":"tool_call","toolName":"edit","summary":"edit unitsystem.py: use is_dimensionless(dim) instead of structural equality"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));
    const cases: Array<[string, string]> = [
      ['Tool sequence: bash -> edit -> bash. Done reviewing.', ''],
      ['The fix is in place. confirmed.', ''],
      ['Full sympy/physics/units/tests/ suite: 70 passed, 1 xfailed', ''],
    ];
    for (const [finalSummary, expected] of cases) {
      expect(distillRunEvents({
        events: base, evidenceTask: 'sympy__sympy-24066', repo: 'sympy/sympy', finalSummary,
      })?.fix_summary).toBe(expected);
    }
  });

  it('φ_exec accepts grounded fix and rejects test-report against rich evidence', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"ValueError: Dimension of exp(...)"}',
      '{"kind":"tool_call","toolName":"edit","summary":"edit unitsystem.py: call is_dimensionless(dim) for exponent check; SI.get_dimension_system().is_dimensionless"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));
    const good = distillRunEvents({
      events,
      evidenceTask: 'sympy__sympy-24066',
      repo: 'sympy/sympy',
      finalSummary: 'The fix is to call `is_dimensionless()` on the collected dimension before rejecting exponents.',
    });
    expect(good?.fix_summary.toLowerCase()).toContain('is_dimensionless');
    expect(good?.confidence).toBe('verified');
    expect(good?.verification).toBeTruthy();
    expect(good?.execution_evidence).toContain('is_dimensionless');

    const bad = distillRunEvents({
      events,
      evidenceTask: 'sympy__sympy-24066',
      repo: 'sympy/sympy',
      finalSummary: 'The fix is Full sympy/physics/units/tests/ suite: 70 passed, 1 xfailed.',
    });
    expect(bad?.fix_summary).toBe('');
    expect(bad?.confidence).toBe('candidate');
    expect(bad?.verification).toMatch(/passed/);
  });

  it('keeps empty verification/execution_evidence safe for legacy render shape', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"AssertionError: expected 2, got 1"}',
      '{"kind":"tool_call","toolName":"edit","summary":"fix"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));
    const candidate = distillRunEvents({
      events,
      evidenceTask: 'owner__repo-123',
      repo: 'owner/repo',
      finalSummary: 'The fix is to assign `x` back.',
    });
    expect(candidate).toMatchObject({
      fix_summary: 'to assign `x` back.',
      verification: expect.any(String),
    });
    // Thin edit summary → no execution_evidence key forced; consumers must tolerate absence.
    const rendered = `Symptom: ${candidate?.symptom} Fix: ${candidate?.fix_summary}`;
    expect(rendered.includes('undefined')).toBe(false);
  });

  it('does not mid-cut long convert_to fix under v3 soft/hard limits', () => {
    const longFix =
      'The fix is to return `None` so convert_to leaves orthogonal units unchanged when no exact conversion exists in the unit system.';
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"odd convert_to joule**(7/9)"}',
      '{"kind":"tool_call","toolName":"edit","summary":"edit util.py convert_to: return None when solve fails for orthogonal units instead of partial combine"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));
    const fix = distillRunEvents({
      events,
      evidenceTask: 'sympy__sympy-20442',
      repo: 'sympy/sympy',
      finalSummary: longFix,
    })?.fix_summary ?? '';
    expect(fix).toContain('return `None`');
    expect(fix.endsWith('.')).toBe(true);
    expect(fix.includes('…')).toBe(false);
  });

  it('redistills the real 20442 summary past the upstream 600-character boundary', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"odd convert_to joule**(7/9)"}',
      '{"kind":"tool_call","toolName":"edit","summary":"edit util.py: check camat * res_exponents == exprmat and return None"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));
    const prefix = 'Reproduced the issue and inspected the least-squares solver behavior. '.repeat(10);
    const fix = distillRunEvents({
      events,
      evidenceTask: 'sympy__sympy-20442',
      repo: 'sympy/sympy',
      finalSummary: `${prefix}The fix is to verify the solution is exact; if not, return \`None\` so \`convert_to\` returns the original expression unchanged. All conversions work correctly.`,
    })?.fix_summary ?? '';

    expect(fix).toContain('return `None`');
    expect(fix).toContain('`convert_to` returns the original expression unchanged');
    expect(fix.endsWith('.')).toBe(true);
    expect(fix).not.toContain('…');
  });

  it('bounds the real 24066 fix and routes diff and validation to evidence fields', () => {
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"ValueError: Dimension mismatch"}',
      '{"kind":"tool_call","toolName":"apply_patch","summary":"apply_patch unitsystem.py: use is_dimensionless(d[1]) and return Dimension(1)"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));
    const candidate = distillRunEvents({
      events,
      evidenceTask: 'sympy__sympy-24066',
      repo: 'sympy/sympy',
      finalSummary: [
        'The fix is complete and validated.',
        '## Summary',
        '**Fix** (production file only — `sympy/physics/units/unitsystem.py`):',
        '- Added a dimensionless check: call `is_dimensionless()` and return `Dimension(1)`.',
        '```diff',
        '+ if all(self.get_dimension_system().is_dimensionless(d[1]) for d in fds):',
        '+     return expr.func(*(f[0] for f in fds)), Dimension(1)',
        '```',
        '**Validation:**',
        '- Issue reproduction now returns `(E + 100, Dimension(1))` instead of raising.',
      ].join('\n'),
    });

    expect(candidate?.fix_summary).toContain('`is_dimensionless()`');
    expect(candidate?.fix_summary).not.toMatch(/```|Validation/);
    expect(candidate?.execution_evidence).toMatch(/apply_patch|```diff/);
    expect(candidate?.verification).toContain('Issue reproduction now returns');
  });

  it('rejects change metadata and redistills 24213 to equivalent_dims()', () => {
    for (const metadata of [
      'Files changed: sympy/physics/units/unitsystem.py.',
      '2 files changed, 4 insertions(+), 1 deletion(-).',
      'diff --git a/unitsystem.py b/unitsystem.py',
      '@@ -181,7 +181,8 @@ class UnitSystem:',
    ]) {
      expect(isBlacklistedFix(metadata)).toBe(true);
    }
    const events = parseJsonLines([
      '{"kind":"tool_error","toolName":"bash","summary":"ValueError: equivalent dimensions rejected"}',
      '{"kind":"tool_call","toolName":"edit","summary":"edit unitsystem.py: replace strict dim inequality with equivalent_dims(dim, addend_dim)"}',
      '{"kind":"verifier","reward":1}',
    ].join('\n'));
    const candidate = distillRunEvents({
      events,
      evidenceTask: 'sympy__sympy-24213',
      repo: 'sympy/sympy',
      finalSummary: [
        '**Fix:** Replaced strict inequality with `equivalent_dims(dim, addend_dim)`.',
        '**Validation:** Equivalent dimensions now add, while incompatible dimensions still raise.',
        '**Files changed:** sympy/physics/units/unitsystem.py (one 2-line change).',
      ].join('\n'),
    });

    expect(candidate?.fix_summary).toContain('`equivalent_dims(dim, addend_dim)`');
    expect(candidate?.fix_summary).not.toContain('Files changed');
  });

  it('links run archives to their task and resolved harness result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knack-distillation-'));
    const memoryDir = join(root, 'tier-b-on-memory');
    const runDir = join(memoryDir, 'runs', 'run_1');
    const resultDir = join(root, 'tier-b-on-123');
    const output = join(root, 'candidate-knacks.json');
    try {
      await mkdir(runDir, { recursive: true });
      await mkdir(resultDir, { recursive: true });
      await writeFile(join(memoryDir, 'tasks.json'), JSON.stringify({
        tasks: [{ id: 'task_1', name: 'Eval task: SWE-bench owner__repo-123' }],
      }));
      await writeFile(join(runDir, 'outcome.json'), JSON.stringify({
        taskId: 'task_1',
        finalSummary: 'Patched the parser and reran its tests.',
      }));
      await writeFile(join(runDir, 'events.jsonl'), [
        '{"kind":"tool_error","toolName":"bash","summary":"parser test failed"}',
        '{"kind":"tool_call","toolName":"edit","summary":"patch parser"}',
        '{"kind":"tool_call","toolName":"bash","summary":"rerun parser tests"}',
      ].join('\n'));
      await writeFile(join(resultDir, 'metadata.json'), JSON.stringify({
        studentMemoryDir: memoryDir,
        instances: [{ instanceId: 'owner__repo-123' }],
      }));
      await writeFile(join(resultDir, 'harness-report.json'), JSON.stringify({
        resolved_ids: ['owner__repo-123'],
      }));

      const candidates = await distillResults(root, output);

      expect(candidates).toHaveLength(1);
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(candidates);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
