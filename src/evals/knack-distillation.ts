import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  findCausalPair,
  type VerificationKind,
} from './causal-pair.js';

export interface DistillationEvent {
  line: number;
  data: Record<string, unknown>;
}

export interface CandidateKnack {
  id: string;
  dedup_key: string;
  repo: string;
  symptom: string;
  fix_summary: string;
  /** audit only, not injected */
  verified_fix: string;
  evidence_task: string;
  evidence_turns: [number, number];
  compression_level: 'knack';
  confidence: 'verified' | 'candidate';
  reuse_count: 0;
  injected_count: 0;
  last_succeeded_task: null;
  last_injected_task: null;
  unit_test: string;
}

export interface DistillRunInput {
  events: DistillationEvent[];
  evidenceTask: string;
  repo: string;
  verification?: VerificationKind;
  finalSummary?: string;
  /** SWE issue body / task instruction — preferred symptom source (fidelity v2). */
  taskInstruction?: string;
}

interface VerificationEvidence {
  memoryDirName: string;
  instanceId: string;
  verification: VerificationKind;
}

export function parseJsonLines(content: string): DistillationEvent[] {
  const events: DistillationEvent[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line) as unknown;
      if (isRecord(data)) {
        events.push({ line: index + 1, data });
      }
    } catch {
      // Preserve the rest of a run when a single audit line is malformed.
    }
  }
  return events;
}

export function distillRunEvents(input: DistillRunInput): CandidateKnack | null {
  const pair = findCausalPair(input.events, { verification: input.verification });
  if (!pair || !pair.verification) return null;

  const error = input.events[pair.errorIndex];
  const operations = pair.operationIndices.map((index) => input.events[index]);
  const lastOperation = operations.at(-1);
  if (!error || !lastOperation) return null;

  const actionSequence = operations
    .map(({ data }) => stringValue(data.toolName) ?? stringValue(data.name) ?? 'tool')
    .join(' -> ');
  const summary = input.finalSummary
    ? ` ${summarizeText(input.finalSummary, 600)}`
    : '';
  const verifiedFix = `Tool sequence: ${actionSequence}.${summary}`.trim();
  const symptom = extractSymptom({
    verifiedFix,
    fallback: stringValue(error.data.summary) ?? 'Unknown tool error',
    events: input.events,
    taskInstruction: input.taskInstruction,
  });
  const { fix_summary: fixSummary, confidence } = extractFixSummary(
    verifiedFix,
    input.finalSummary,
  );
  const dedupKey = buildDedupKey(input.repo, symptom);
  const hash = createHash('sha256')
    .update(`${input.repo}\n${input.evidenceTask}\n${symptom}\n${verifiedFix}`)
    .digest('hex')
    .slice(0, 12);
  const verificationNote = pair.verification === 'exit 0'
    ? 'Verified by exit 0.'
    : 'Verified by verifier reward=1.';

  return {
    id: `knack-${slug(input.repo)}-${hash}`,
    dedup_key: dedupKey,
    repo: input.repo,
    symptom,
    fix_summary: fixSummary,
    // audit only, not injected
    verified_fix: verifiedFix,
    evidence_task: input.evidenceTask,
    evidence_turns: [error.line, lastOperation.line],
    compression_level: 'knack',
    confidence,
    reuse_count: 0,
    injected_count: 0,
    last_succeeded_task: null,
    last_injected_task: null,
    unit_test: fixSummary
      ? verificationNote
      : `${verificationNote} Fix not extracted.`,
  };
}

/** Marker hit → verified; else last code-bearing finalSummary sentence; else empty + candidate. */
export function extractFixSummary(
  verifiedFix: string,
  finalSummary?: string,
): { fix_summary: string; confidence: 'verified' | 'candidate' } {
  for (const marker of [
    /(?:^|[.!?\n])(?:\s|\*)*The fix is\s*[:\s]\s*(.+)$/i,
    /(?:^|[\s\n])\*{0,2}Fix\*{0,2}\s*:\s*(.+)$/i,
    /(?:^|[.!?\n])(?:\s|\*)*The solution is\s*[:\s]\s*(.+)$/i,
  ]) {
    const markedText = verifiedFix.match(marker)?.[1]?.trim();
    if (markedText) {
      return {
        fix_summary: softSummarize(firstSentence(markedText)),
        confidence: 'verified',
      };
    }
  }
  const codeSentence = lastCodeBearingSentence(finalSummary);
  if (codeSentence) {
    return {
      fix_summary: softSummarize(codeSentence),
      confidence: 'verified',
    };
  }
  // Never fall back to "Tool sequence: …" audit prose.
  return { fix_summary: '', confidence: 'candidate' };
}

function lastCodeBearingSentence(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined;
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index];
    if (hasCodeSymbols(sentence)) return sentence;
  }
  return undefined;
}

function hasCodeSymbols(sentence: string): boolean {
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

function isProcessNoiseErrorSummary(summary: string): boolean {
  const s = summary.toLowerCase();
  return s.includes('hashline') || s.includes('modulenotfounderror') || s.includes('no module named')
    || s.includes('import error') || s.startsWith('sed:');
}

function isSubstantialToolError(summary: string): boolean {
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

/** Soft 150 / hard 300; end on sentence boundary — no mid-clause chop at 150. */
export function softSummarize(text: string, softLimit = 150, hardLimit = 300): string {
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

export async function distillResults(
  resultsDir: string,
  outputPath: string,
): Promise<CandidateKnack[]> {
  const verificationIndex = await buildVerificationIndex(resultsDir);
  const eventFiles = await findNamedFiles(resultsDir, 'events.jsonl');
  const candidates: CandidateKnack[] = [];

  for (const eventFile of eventFiles.sort()) {
    const runDir = dirname(eventFile);
    const memoryDir = dirname(dirname(runDir));
    const outcome = await readJson(join(runDir, 'outcome.json'));
    const taskId = stringValue(outcome?.taskId);
    const task = taskId
      ? await findTask(memoryDir, taskId)
      : undefined;
    const evidenceTask = inferEvidenceTask(task, taskId ?? basename(runDir));
    const verification = verificationIndex.get(verificationKey(basename(memoryDir), evidenceTask));
    const events = parseJsonLines(await readFile(eventFile, 'utf8'));
    const candidate = distillRunEvents({
      events,
      evidenceTask,
      repo: inferRepo(evidenceTask),
      verification,
      finalSummary: stringValue(outcome?.finalSummary),
    });
    if (candidate) candidates.push(candidate);
  }

  const unique = deduplicateCandidates(candidates);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(unique, null, 2)}\n`, 'utf8');
  return unique;
}

export function deduplicateCandidates(candidates: CandidateKnack[]): CandidateKnack[] {
  const byKey = new Map<string, CandidateKnack>();
  for (const candidate of candidates) {
    const existing = byKey.get(candidate.dedup_key);
    if (!existing || evidenceSpan(candidate) < evidenceSpan(existing)) {
      byKey.set(candidate.dedup_key, candidate);
    }
  }
  return [...byKey.values()];
}

function buildDedupKey(repo: string, symptom: string): string {
  const fingerprint = createHash('sha256')
    .update(normalizeSymptom(symptom))
    .digest('hex')
    .slice(0, 12);
  return `${slug(repo)}:${fingerprint}`;
}

function normalizeSymptom(symptom: string): string {
  const normalizedText = symptom
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const anchor = codeAnchor(symptom);
  const category = failureCategory(normalizedText);
  return anchor && category
    ? `${anchor} ${category}`
    : normalizedText;
}

function evidenceSpan(candidate: CandidateKnack): number {
  return candidate.evidence_turns[1] - candidate.evidence_turns[0];
}

function firstSentence(value: string): string {
  return value.match(/^.*?[.!?](?=\s|$|[A-Z][a-z]+\s)/)?.[0] ?? value;
}

function meaningfulRootCause(value: string): string {
  const first = firstSentence(value);
  const remainder = value.slice(first.length).trim();
  if (remainder && /^(?:in\s+)?`[^`]+`[.!?]?$/i.test(first.trim())) {
    return `${first} ${firstSentence(remainder)}`;
  }
  return first;
}

function codeAnchor(symptom: string): string | undefined {
  const raw = symptom.match(/`([^`]+)`/)?.[1]
    ?.replace(/\([^)]*\)/g, '')
    .trim();
  if (!raw) return undefined;
  const parts = raw.split('.').filter(Boolean);
  const canonical = /^[A-Z]/.test(raw) || raw.startsWith('_')
    ? raw
    : parts.at(-1) ?? raw;
  return canonical.toLowerCase().replace(/[^a-z0-9_]+/g, '');
}

function failureCategory(normalizedText: string): string | undefined {
  if (/\b(?:none|null)\b/.test(normalizedText)) return 'null-handling';
  if (
    /(?:does not|doesn t|never)\s+(?:re)?assign\b.*\bresult\b/.test(normalizedText)
    || /\bresult\b.*\bdiscard(?:ed)?\b/.test(normalizedText)
    || /\bnot\s+(?:an?\s+)?in\s+place\b/.test(normalizedText)
  ) {
    return 'discarded-return';
  }
  if (/(?:does not|doesn t)\s+accept\b|\bmissing\b.*\bparameter\b/.test(normalizedText)) {
    return 'missing-parameter';
  }
  if (/\bfill(?:s|ed)?\b.*\b1\b|\bcopy(?:ing|ied)?\b.*\bmatrix\b/.test(normalizedText)) {
    return 'incorrect-copy';
  }
  return undefined;
}

async function buildVerificationIndex(
  resultsDir: string,
): Promise<Map<string, VerificationEvidence['verification']>> {
  const index = new Map<string, VerificationEvidence['verification']>();
  const metadataFiles = await findNamedFiles(resultsDir, 'metadata.json');

  for (const metadataFile of metadataFiles) {
    const metadata = await readJson(metadataFile);
    const memoryDir = stringValue(metadata?.studentMemoryDir);
    const instances = Array.isArray(metadata?.instances) ? metadata.instances : [];
    if (!memoryDir) continue;

    const harness = await readJson(join(dirname(metadataFile), 'harness-report.json'));
    const resolvedIds = new Set(
      Array.isArray(harness?.resolved_ids)
        ? harness.resolved_ids.filter((value): value is string => typeof value === 'string')
        : [],
    );

    for (const instance of instances) {
      if (!isRecord(instance)) continue;
      const instanceId = stringValue(instance.instanceId);
      if (!instanceId) continue;
      const verification = resolvedIds.has(instanceId) || numberValue(instance.reward) === 1
        ? 'verifier reward=1'
        : numberValue(instance.exitCode) === 0
          ? 'exit 0'
          : undefined;
      if (verification) {
        index.set(verificationKey(basename(memoryDir), instanceId), verification);
      }
    }
  }

  return index;
}

async function findTask(memoryDir: string, taskId: string): Promise<Record<string, unknown> | undefined> {
  const tasksDocument = await readJson(join(memoryDir, 'tasks.json'));
  const tasks = Array.isArray(tasksDocument?.tasks) ? tasksDocument.tasks : [];
  return tasks.find(
    (task): task is Record<string, unknown> => isRecord(task) && task.id === taskId,
  );
}

async function findNamedFiles(root: string, targetName: string): Promise<string[]> {
  const matches: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return matches;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findNamedFiles(path, targetName));
    } else if (entry.isFile() && entry.name === targetName) {
      matches.push(path);
    }
  }
  return matches;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function inferEvidenceTask(task: Record<string, unknown> | undefined, fallback: string): string {
  const name = stringValue(task?.name);
  if (!name) return fallback;
  return name.replace(/^Eval task:\s*(?:SWE-bench\s*)?/i, '').trim() || fallback;
}

function inferRepo(evidenceTask: string): string {
  const [owner, repositoryWithIssue] = evidenceTask.split('__');
  if (owner && repositoryWithIssue) {
    return `${owner}/${repositoryWithIssue.replace(/-\d+$/, '')}`;
  }
  return evidenceTask.split(/[-/]/)[0] || 'unknown';
}

function summarizeText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars - 1)}…`;
}

function verificationKey(memoryDirName: string, instanceId: string): string {
  return `${memoryDirName}\0${instanceId}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
