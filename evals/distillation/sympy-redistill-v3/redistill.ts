import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import {
  distillRunEvents,
  parseJsonLines,
  type CandidateKnack,
  type DistillationEvent,
} from '../../../src/evals/knack-distillation.js';
import { execGroundingSimilarity } from '../../../src/evals/exec-grounding.js';

const EXTRACTOR_COMMIT = '87f6a2170352094b090f8b16432abb409014d5d6';
const FAMILY = 'F-SY-UNIT-EQUIVALENCE';
const TASKS = [
  { ordinal: 1, instanceId: 'sympy__sympy-20442' },
  { ordinal: 2, instanceId: 'sympy__sympy-24066' },
  { ordinal: 3, instanceId: 'sympy__sympy-24213' },
] as const;

type JsonObject = Record<string, unknown>;
type ToolCall = {
  id?: string;
  name?: string;
  args?: unknown;
  isError?: boolean;
  resultText?: string;
};

const inputRoot = process.argv[2] ? resolve(process.argv[2]) : '';
if (!inputRoot) {
  throw new Error('usage: npx tsx evals/distillation/sympy-redistill-v3/redistill.ts <v0.2-results-root>');
}

const outputRoot = resolve('evals/distillation/sympy-redistill-v3');
const armRoot = join(inputRoot, 'A-L', FAMILY);

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<JsonObject> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isObject(value)) throw new Error(`expected JSON object: ${path}`);
  return value;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function findRunDir(ordinal: number, instanceId: string): Promise<string> {
  const prefix = `${ordinal}-${instanceId}`;
  const matches = (await readdir(armRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name === prefix)
    .map((entry) => join(armRoot, entry.name));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one real run directory for ${prefix}; found ${matches.length}`);
  }
  return matches[0]!;
}

function toolCallsFromRecords(records: JsonObject): ToolCall[] {
  const rows = Array.isArray(records.records) ? records.records : [];
  const first = rows[0];
  if (!isObject(first) || !isObject(first.trace) || !Array.isArray(first.trace.toolCalls)) {
    throw new Error('records.json lacks records[0].trace.toolCalls');
  }
  return first.trace.toolCalls.filter(isObject) as ToolCall[];
}

function hydrateEditEvidence(events: DistillationEvent[], calls: ToolCall[]): DistillationEvent[] {
  const byId = new Map(calls.flatMap((call) => call.id ? [[call.id, call] as const] : []));
  return events.map((event) => {
    const metadata = isObject(event.data.metadata) ? event.data.metadata : undefined;
    const evidenceRef = stringValue(metadata?.evidenceRef);
    const call = evidenceRef ? byId.get(evidenceRef) : undefined;
    const tool = (stringValue(event.data.toolName) ?? call?.name ?? '').toLowerCase();
    if (!call || !/edit|apply_patch|write|str_replace|patch/.test(tool)) return event;

    // Lossless evidence hydration: use the recorded tool arguments verbatim.
    // Do not paraphrase, omit failed attempts, or introduce reconstructed strings.
    return {
      ...event,
      data: {
        ...event.data,
        summary: `${tool} ${JSON.stringify(call.args ?? {})}`,
        recordedToolError: call.isError === true,
      },
    };
  });
}

function recordTrace(records: JsonObject): JsonObject {
  const rows = Array.isArray(records.records) ? records.records : [];
  const first = rows[0];
  if (!isObject(first) || !isObject(first.trace)) {
    throw new Error('records.json lacks records[0].trace');
  }
  return first.trace;
}

function actualInjections(injectionText: string): Array<{
  memoryId: string;
  symptom: string;
  fixSummary: string;
  rawLine: string;
}> {
  return injectionText.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^- \[(?:recall|resident):([^\]]+)\] Symptom: (.*?) Fix: (.*)$/);
    return match
      ? [{
        memoryId: match[1]!,
        symptom: match[2]!,
        fixSummary: match[3]!,
        rawLine: line,
      }]
      : [];
  });
}

function candidateArray(admission: JsonObject): CandidateKnack[] {
  if (!isObject(admission.distillation) || !Array.isArray(admission.distillation.distilled)) {
    throw new Error('admission.json lacks distillation.distilled');
  }
  return admission.distillation.distilled as CandidateKnack[];
}

function psi(fixSummary: string | undefined, executionEvidence: string | undefined): number | null {
  if (!fixSummary?.trim() || !executionEvidence?.trim()) return null;
  return execGroundingSimilarity(fixSummary, executionEvidence);
}

const beforeRuns: JsonObject[] = [];
const afterRuns: JsonObject[] = [];

for (const task of TASKS) {
  const runDir = await findRunDir(task.ordinal, task.instanceId);
  const eventsPath = join(runDir, 'events.jsonl');
  const recordsPath = join(runDir, 'records.json');
  const tracePath = join(runDir, 'trace.json');
  const injectionPath = join(runDir, 'injection.txt');
  const admissionPath = join(runDir, 'admission.json');
  const [eventsText, recordsText, traceText, injectionText, admissionText] = await Promise.all([
    readFile(eventsPath, 'utf8'),
    readFile(recordsPath, 'utf8'),
    readFile(tracePath, 'utf8'),
    readFile(injectionPath, 'utf8'),
    readFile(admissionPath, 'utf8'),
  ]);
  for (const [name, content] of Object.entries({
    events: eventsText,
    records: recordsText,
    trace: traceText,
    injection: injectionText,
    admission: admissionText,
  })) {
    if (!content.trim()) throw new Error(`${task.instanceId}: ${name} archive is empty`);
  }

  const records = JSON.parse(recordsText) as JsonObject;
  const admission = JSON.parse(admissionText) as JsonObject;
  if (!isObject(admission.admission) || admission.admission.resolved !== true) {
    throw new Error(`${task.instanceId}: run is not harness-resolved`);
  }
  const trace = recordTrace(records);
  const originalEvents = parseJsonLines(eventsText);
  const hydratedEvents = hydrateEditEvidence(originalEvents, toolCallsFromRecords(records));
  const oldCandidates = candidateArray(admission);
  const candidate = distillRunEvents({
    events: hydratedEvents,
    evidenceTask: task.instanceId,
    repo: 'sympy/sympy',
    verification: 'verifier reward=1',
    finalSummary: stringValue(trace.finalOutput),
    taskInstruction: stringValue(trace.instruction),
  });
  if (!candidate) throw new Error(`${task.instanceId}: v3 returned null from real events`);

  beforeRuns.push({
    ordinal: task.ordinal,
    instance_id: task.instanceId,
    source_run_dir: relative(inputRoot, runDir),
    source_sha256: {
      events_jsonl: sha256(eventsText),
      records_json: sha256(recordsText),
      trace_json: sha256(traceText),
      injection_txt: sha256(injectionText),
      admission_json: sha256(admissionText),
    },
    actual_injection_from_injection_txt: actualInjections(injectionText),
    old_distillation_candidates: oldCandidates,
  });

  afterRuns.push({
    ordinal: task.ordinal,
    instance_id: task.instanceId,
    input_event_count: originalEvents.length,
    hydrated_edit_or_patch_events: hydratedEvents.filter((event, index) =>
      event.data.summary !== originalEvents[index]?.data.summary).length,
    new_candidate: candidate,
    phi_exec: {
      new_psi: psi(candidate.fix_summary, candidate.execution_evidence),
      old_candidates: oldCandidates.map((old) => ({
        id: old.id,
        fix_summary: old.fix_summary,
        psi_against_real_execution_evidence: psi(old.fix_summary, candidate.execution_evidence),
      })),
    },
  });
}

await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, 'v4-before.json'), `${JSON.stringify({
  kind: 'sympy-v0.2-fidelity-v4-before',
  extractor_commit: EXTRACTOR_COMMIT,
  source_results_root: inputRoot,
  source_policy: 'read-only real A-L events/records/trace/injection/admission; no reconstructed samples',
  runs: beforeRuns,
}, null, 2)}\n`, 'utf8');
await writeFile(join(outputRoot, 'v4-after.json'), `${JSON.stringify({
  kind: 'sympy-v0.2-fidelity-v4-redistill',
  extractor_commit: EXTRACTOR_COMMIT,
  evidence_hydration: 'events metadata.evidenceRef -> records[0].trace.toolCalls; edit/apply_patch args copied verbatim; failed attempts retained',
  model_calls: 0,
  swebench_runs: 0,
  harness_calls: 0,
  runs: afterRuns,
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  extractorCommit: EXTRACTOR_COMMIT,
  inputRoot,
  outputRoot,
  runs: afterRuns.map((run) => ({
    instance_id: run.instance_id,
    new_fix_summary: (run.new_candidate as CandidateKnack).fix_summary,
    new_psi: (run.phi_exec as JsonObject).new_psi,
  })),
}, null, 2));
