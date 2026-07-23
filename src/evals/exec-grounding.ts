/** φ_exec — SPARK/PDI arXiv:2605.09192. Deterministic; no model calls. */
export const PHI_EXEC_ALPHA = 0.002;
/** Midpoint of test-report-band gap; full pos/neg not separable — see phi-exec-calibration-v3.md */
export const PHI_EXEC_THRESHOLD = 0.067;

export function tokenizeWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9_`.]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function smoothed(counts: Map<string, number>, vocab: string[], alpha: number): Map<string, number> {
  const total = [...counts.values()].reduce((a, b) => a + b, 0) + alpha * vocab.length;
  return new Map(vocab.map((w) => [w, ((counts.get(w) ?? 0) + alpha) / total]));
}

function countTokens(toks: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Jensen–Shannon in [0,1] with base-2 log. */
export function jsDivergence(p: Map<string, number>, q: Map<string, number>, vocab: string[]): number {
  let js = 0;
  for (const w of vocab) {
    const pw = p.get(w) ?? 0;
    const qw = q.get(w) ?? 0;
    const m = (pw + qw) / 2;
    if (pw > 0 && m > 0) js += 0.5 * pw * Math.log2(pw / m);
    if (qw > 0 && m > 0) js += 0.5 * qw * Math.log2(qw / m);
  }
  return js;
}

/** ψ = 1 − JS(P_fix, P_evidence). */
export function execGroundingSimilarity(fixText: string, executionEvidence: string, alpha = PHI_EXEC_ALPHA): number {
  const fixToks = tokenizeWords(fixText);
  const evidToks = tokenizeWords(executionEvidence);
  if (!fixToks.length || !evidToks.length) return 0;
  const vocab = [...new Set([...fixToks, ...evidToks])].sort();
  return 1 - jsDivergence(smoothed(countTokens(fixToks), vocab, alpha), smoothed(countTokens(evidToks), vocab, alpha), vocab);
}

export function passesPhiExec(fixText: string, executionEvidence: string, threshold = PHI_EXEC_THRESHOLD): boolean {
  if (tokenizeWords(executionEvidence).length < 8) return true; // thin evidence → blacklist/whitelist
  return execGroundingSimilarity(fixText, executionEvidence) >= threshold;
}
