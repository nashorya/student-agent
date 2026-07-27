/**
 * Shared distillation fidelity extraction (v2 symptom sourcing + v3 φ_exec / blacklist).
 *
 * Used by both the online lesson writer (`src/memory/lessons`) and the audit-only
 * offline distiller (`src/evals/knack-distillation.ts`) so both paths phrase
 * symptom/fix identically.
 *
 * per SPARK/PDI-2605.09192 · per CoT-Evo-2510.13166
 */

import { passesPhiExec } from './exec-grounding.js';

export interface DistillationEvent {
  line: number;
  data: Record<string, unknown>;
}

/** Marker / code-sentence candidates → φ_exec then blacklist/whitelist; else empty + candidate. */
export function extractFixSummary(
  verifiedFix: string,
  finalSummary?: string,
  executionEvidence = '',
): { fix_summary: string; confidence: 'verified' | 'candidate' } {
  const candidates: string[] = [];
  for (const marker of [
    /(?:^|[.!?\n])(?:\s|\*)*The fix is\s*[:\s]\s*(.+)$/ims,
    /(?:^|[\s\n])\*{0,2}Fix\*{0,2}\s*:\s*(.+)$/ims,
    /(?:^|[.!?\n])(?:\s|\*)*The solution is\s*[:\s]\s*(.+)$/ims,
  ]) {
    const markedText = verifiedFix.match(marker)?.[1]?.trim();
    if (markedText) candidates.push(firstSentence(markedText));
  }
  for (const sentence of codeBearingSentences(finalSummary)) {
    candidates.push(sentence);
  }
  for (const raw of candidates) {
    const fix = softSummarize(raw);
    if (!fix || isBlacklistedFix(fix)) continue;
    if (!isWhitelistedFix(fix)) continue;
    if (!passesPhiExec(fix, executionEvidence)) continue;
    return { fix_summary: fix, confidence: 'verified' };
  }
  return { fix_summary: '', confidence: 'candidate' };
}

/** Patch / edit / apply_patch summaries — execution grounding corpus. */
export function extractExecutionEvidence(
  operations: DistillationEvent[],
): string {
  return operations
    .map(({ data }) => {
      const tool = (stringValue(data.toolName) ?? stringValue(data.name) ?? '').toLowerCase();
      const summary = stringValue(data.summary) ?? '';
      const isEdit = /edit|apply_patch|write|str_replace|patch/i.test(tool)
        || /[+]{3}|diff --git|@@/.test(summary);
      if (!isEdit && !(summary.length >= 40 && hasCodeSymbols(summary))) return '';
      // Skip placeholder summaries ("fix"/"patch") — φ_exec needs real corpus.
      if (summary.length < 24 && !hasCodeSymbols(summary)) return '';
      return `${tool} ${summary}`.trim();
    })
    .filter(Boolean)
    .join('\n');
}

export function buildVerificationField(
  kind: 'exit 0' | 'verifier reward=1',
  events: DistillationEvent[],
  finalSummary?: string,
): string {
  const parts: string[] = [
    kind === 'exit 0' ? 'exit 0' : 'verifier reward=1',
  ];
  const corpus = `${finalSummary ?? ''}\n${events.map((e) => stringValue(e.data.summary) ?? '').join('\n')}`;
  const suite = corpus.match(/(\d+)\s+passed(?:,\s*(\d+)\s+x?failed)?/i);
  if (suite) {
    parts.push(`${suite[1]} passed${suite[2] ? `, ${suite[2]} failed/xfailed` : ''}`);
  }
  return parts.join('; ');
}

/** Test reports / status fluff / meta-narration — CoT-Evo deletive + SPARK verification split. */
export function isBlacklistedFix(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/^\s*Tool sequence:/i.test(t)) return true;
  if (/\b\d+\s+(passed|failed|xfailed)\b/i.test(t)) return true;
  if (/tests?\/[\w./-]+/i.test(t) && /\b\d+\b/.test(t)) return true;
  if (/\b(fix is in place|works now)\b/i.test(t)) return true;
  if (/^(confirmed\.?|ok\.?|done\.?)$/i.test(t)) return true;
  if (/\b(the user says|tips mention|correct answer)\b/i.test(t)) return true;
  return false;
}

/** Change verb and/or code citation required (v2 whitelist retained). */
export function isWhitelistedFix(text: string): boolean {
  if (hasCodeSymbols(text)) return true;
  return /\b(assign|add(?:ed)?|return|copy|replace|call|use|set|check|handle|preserve|accept|restore|update|insert|remove|delete|move|rename|cast|wrap|unwrap|branch|elif|else|validate)\b/i
    .test(text);
}

function codeBearingSentences(text: string | undefined): string[] {
  if (!text?.trim()) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const hits: string[] = [];
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index];
    if (hasCodeSymbols(sentence)) hits.push(sentence);
  }
  return hits;
}

export function hasCodeSymbols(sentence: string): boolean {
  if (/`[^`]+`/.test(sentence)) return true;
  if (/\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b/.test(sentence)) return true;
  if (/\b[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(sentence)) return true;
  return false;
}

/** Fidelity v2: issue surface → substantial tool error → agent narrative; reject fluff. */
export function extractSymptom(input: {
  verifiedFix: string;
  fallback: string;
  events?: DistillationEvent[];
  taskInstruction?: string;
}): string {
  const pick = (value?: string) => (value && isInformativeSymptom(value) ? softSummarize(value) : undefined);
  const afterInst = input.taskInstruction?.split(/Instance:\s*\S+\s*/i)[1] ?? input.taskInstruction;
  const issueLine = afterInst?.split(/\n/).map((l) => l.trim()).filter(Boolean)
    .find((l) => !/^(Resolve this|Edit only|Do not edit|When finished|Instance:)/i.test(l));
  const fromIssue = pick(issueLine);
  if (fromIssue) return fromIssue;
  for (const event of input.events ?? []) {
    const d = event.data;
    const kind = stringValue(d.kind) ?? stringValue(d.type) ?? '';
    if (!(kind.includes('error') || d.isError === true)) continue;
    const summary = stringValue(d.summary) ?? '';
    if (!isSubstantialToolError(summary)) continue;
    const line = pick(summary.split(/\n/)[0]?.trim());
    if (line) return line;
  }
  const agentRaw = input.verifiedFix.match(/(?:The bug is|Root cause:|The issue is)\s*(.+)$/i)?.[1]
    ?.replace(/^clear\s*(?:[.:]\s*)/i, '').trim()
    ?? input.verifiedFix.match(/(?:I can see the bug|I can see the issue|I understand the issue)[.!:]\s*(.+)$/i)?.[1]?.trim();
  const fromAgent = agentRaw ? pick(meaningfulRootCause(agentRaw)) : undefined;
  if (fromAgent) return fromAgent;
  return softSummarize(isSubstantialToolError(input.fallback) ? input.fallback : (input.fallback || 'Unknown tool error'));
}

export function isProcessNoiseErrorSummary(summary: string): boolean {
  const s = summary.toLowerCase();
  return s.includes('hashline') || s.includes('modulenotfounderror') || s.includes('no module named')
    || s.includes('import error') || s.startsWith('sed:');
}

export function isSubstantialToolError(summary: string): boolean {
  if (!summary.trim() || isProcessNoiseErrorSummary(summary) || !isInformativeSymptom(summary)) return false;
  if (hasCodeSymbols(summary)) return true;
  if (/\b(Error|Exception|AssertionError|Traceback|TypeError|ValueError|AttributeError)\b/i.test(summary)) return true;
  return summary.trim().length >= 50;
}

/** Reject "confirmed." / clear-only fluff without code symbols. */
export function isInformativeSymptom(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return false;
  const bare = trimmed.replace(/[.!?]+$/g, '').trim();
  if (/^(confirmed|clear|ok|done|yes|the issue is clear|the bug is clear)$/i.test(bare)) return false;
  return !(bare.length < 25 && !hasCodeSymbols(trimmed));
}

/** Soft 300 / hard 800; end on sentence boundary — SPARK: over-compression hurts. */
export function softSummarize(text: string, softLimit = 300, hardLimit = 800): string {
  const n = text.replace(/\s+/g, ' ').trim();
  if (n.length <= softLimit) return n;
  const win = n.slice(0, softLimit);
  const endSoft = Math.max(win.lastIndexOf('. '), win.lastIndexOf('! '), win.lastIndexOf('? '));
  if (endSoft >= Math.floor(softLimit * 0.4)) return n.slice(0, endSoft + 1).trim();
  const m = n.slice(softLimit, hardLimit).match(/[.!?](?=\s|$)/);
  if (m?.index !== undefined) return n.slice(0, softLimit + m.index + 1).trim();
  if (n.length <= hardLimit) return n;
  const hard = n.slice(0, hardLimit);
  const lastDot = Math.max(hard.lastIndexOf('. '), hard.lastIndexOf('.'));
  if (lastDot >= Math.floor(hardLimit * 0.5)) return hard.slice(0, lastDot + 1).trim();
  return hard.replace(/\s+\S*$/, '').trim();
}

export function firstSentence(value: string): string {
  return value.match(/^.*?[.!?](?=\s|$|[A-Z][a-z]+\s)/)?.[0] ?? value;
}

export function meaningfulRootCause(value: string): string {
  const first = firstSentence(value);
  const remainder = value.slice(first.length).trim();
  if (remainder && /^(?:in\s+)?`[^`]+`[.!?]?$/i.test(first.trim())) {
    return `${first} ${firstSentence(remainder)}`;
  }
  return first;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
