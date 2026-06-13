import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export interface DistillationEvent {
  line: number;
  data: Record<string, unknown>;
}

export interface CandidateKnack {
  id: string;
  repo: string;
  symptom: string;
  verified_fix: string;
  evidence_task: string;
  evidence_turns: [number, number];
  compression_level: 'knack';
  confidence: 'verified';
  reuse_count: 0;
  unit_test: string;
}

export interface DistillRunInput {
  events: DistillationEvent[];
  evidenceTask: string;
  repo: string;
  verification?: 'exit 0' | 'verifier reward=1';
  finalSummary?: string;
}

interface VerificationEvidence {
  memoryDirName: string;
  instanceId: string;
  verification: 'exit 0' | 'verifier reward=1';
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
  const errorIndex = input.events.findIndex(({ data }) => isErrorEvent(data));
  if (errorIndex < 0) return null;

  const eventVerificationIndex = input.events.findIndex(
    ({ data }, index) => index > errorIndex && detectVerification(data) !== undefined,
  );
  const eventVerification = eventVerificationIndex >= 0
    ? detectVerification(input.events[eventVerificationIndex].data)
    : undefined;
  const verification = eventVerification ?? input.verification;
  if (!verification) return null;

  const sequenceEnd = eventVerificationIndex >= 0
    ? eventVerificationIndex
    : input.events.length;
  const operations = input.events
    .slice(errorIndex + 1, sequenceEnd)
    .filter(({ data }) => isToolCall(data));
  if (operations.length === 0) return null;

  const error = input.events[errorIndex];
  const lastOperation = operations.at(-1);
  if (!lastOperation) return null;

  const symptom = summarizeText(stringValue(error.data.summary) ?? 'Unknown tool error', 280);
  const actionSequence = operations
    .map(({ data }) => stringValue(data.toolName) ?? stringValue(data.name) ?? 'tool')
    .join(' -> ');
  const summary = input.finalSummary
    ? ` ${summarizeText(input.finalSummary, 600)}`
    : '';
  const verifiedFix = `Tool sequence: ${actionSequence}.${summary}`.trim();
  const hash = createHash('sha256')
    .update(`${input.repo}\n${input.evidenceTask}\n${symptom}\n${verifiedFix}`)
    .digest('hex')
    .slice(0, 12);

  return {
    id: `knack-${slug(input.repo)}-${hash}`,
    repo: input.repo,
    symptom,
    verified_fix: verifiedFix,
    evidence_task: input.evidenceTask,
    evidence_turns: [error.line, lastOperation.line],
    compression_level: 'knack',
    confidence: 'verified',
    reuse_count: 0,
    unit_test: verification === 'exit 0'
      ? 'Verified by exit 0.'
      : 'Verified by verifier reward=1.',
  };
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

  const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(unique, null, 2)}\n`, 'utf8');
  return unique;
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

function detectVerification(event: Record<string, unknown>): VerificationEvidence['verification'] | undefined {
  if (numberValue(event.exitCode) === 0 || numberValue(event.exit_code) === 0) {
    return 'exit 0';
  }
  if (numberValue(event.reward) === 1 || numberValue(event.correctnessScore) === 1) {
    return 'verifier reward=1';
  }
  const verifier = isRecord(event.verifier) ? event.verifier : undefined;
  if (verifier && (numberValue(verifier.reward) === 1 || numberValue(verifier.correctnessScore) === 1)) {
    return 'verifier reward=1';
  }
  if (verifier && (numberValue(verifier.exitCode) === 0 || numberValue(verifier.exit_code) === 0)) {
    return 'exit 0';
  }
  return undefined;
}

function isErrorEvent(event: Record<string, unknown>): boolean {
  const kind = stringValue(event.kind) ?? stringValue(event.type) ?? '';
  return kind.includes('error') || event.isError === true;
}

function isToolCall(event: Record<string, unknown>): boolean {
  const kind = stringValue(event.kind) ?? stringValue(event.type) ?? '';
  return kind === 'tool_call' || kind === 'tool-call';
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
