import { describe, expect, it } from 'vitest';
import {
  PHI_EXEC_THRESHOLD,
  execGroundingSimilarity,
  passesPhiExec,
} from '../../memory/distill/exec-grounding.js';

describe('φ_exec exec-grounding', () => {
  /** Event-style evidence (as extractExecutionEvidence would yield). */
  const evidence = {
    cstack: 'edit separable.py: In _cstack when right is ndarray copy matrix values cright = right instead of fill 1 nested CompoundModel',
    mask: 'edit ndarithmetic.py: In _arithmetic_mask add elif operand.mask is None: return deepcopy(self.mask)',
    replace: 'edit fitsrec.py: output_field[:] = output_field.replace(encode_ascii E D); assign replace result back',
  };

  const positives: Array<[string, string, string]> = [
    ['12907', 'The fix copies the actual computed matrix `right` into the correct position, preserving the separability structure of nested CompoundModels.', evidence.cstack],
    ['14995', 'Added an `elif operand.mask is None` branch so missing operand masks return deepcopy(self.mask).', evidence.mask],
    ['6938', 'assign the result of `replace` back to `output_field`.', evidence.replace],
  ];

  const testReportNeg = 'Full sympy/physics/units/tests/ suite: 70 passed, 1 xfailed';
  const fluffNegatives = [
    'The fix is in place.',
    'confirmed.',
    'Tool sequence: bash -> edit -> bash -> bash.',
  ];

  it('rejects test-report band below threshold; accepts calibrated positives', () => {
    const posScores = positives.map(([, fix, evid]) => execGroundingSimilarity(fix, evid));
    const reportScore = execGroundingSimilarity(testReportNeg, evidence.replace);
    expect(Math.min(...posScores)).toBeGreaterThan(PHI_EXEC_THRESHOLD);
    expect(reportScore).toBeLessThan(PHI_EXEC_THRESHOLD);
    for (const [, fix, evid] of positives) {
      expect(passesPhiExec(fix, evid)).toBe(true);
    }
    expect(passesPhiExec(testReportNeg, evidence.replace)).toBe(false);
  });

  it('does not claim full fluff separation — blacklist is required', () => {
    const fluffScores = fluffNegatives.map((fix) => execGroundingSimilarity(fix, evidence.replace));
    // At least one fluff sample may sit near/above threshold under bag-of-words JS.
    expect(Math.max(...fluffScores)).toBeGreaterThan(0.05);
  });

  it('defers when execution evidence is thin', () => {
    expect(passesPhiExec('assign replace back', 'edit fix')).toBe(true);
  });
});
