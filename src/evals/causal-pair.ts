/**
 * Shared error→verification causal-pair criteria (knack distill + lesson admission).
 */

export type VerificationKind = 'exit 0' | 'verifier reward=1';

export interface CausalPairEvent {
  line?: number;
  data: Record<string, unknown>;
}

export interface CausalPair {
  errorIndex: number;
  /** Set only when verification was observed in the event stream. */
  verificationIndex: number | undefined;
  /** Stream or external (harness) terminator; undefined when provisional. */
  verification: VerificationKind | undefined;
  operationIndices: number[];
  /** True when error+ops exist but no stream/external verification yet. */
  provisional: boolean;
  /** True when verification came from in-stream detectVerification. */
  streamVerified: boolean;
}

export function asCausalEvents(
  events: Array<CausalPairEvent | Record<string, unknown>>,
): CausalPairEvent[] {
  return events.map((event, index) => (
    isRecord(event) && isRecord(event.data)
      ? { line: typeof event.line === 'number' ? event.line : index, data: event.data }
      : { line: index, data: event as Record<string, unknown> }
  ));
}

/**
 * First error → verification after it (stream, else options.verification harness fallback).
 * Requires ≥1 tool_call in between. With allowProvisional, error+ops without
 * verification still forms a provisional pair (lesson candidate path).
 */
export function findCausalPair(
  rawEvents: Array<CausalPairEvent | Record<string, unknown>>,
  options?: { verification?: VerificationKind; allowProvisional?: boolean },
): CausalPair | null {
  const events = asCausalEvents(rawEvents);
  const errorIndex = events.findIndex(({ data }) => isErrorEvent(data));
  if (errorIndex < 0) return null;

  const verificationIndexRaw = events.findIndex(
    ({ data }, index) => index > errorIndex && detectVerification(data) !== undefined,
  );
  const streamVerification = verificationIndexRaw >= 0
    ? detectVerification(events[verificationIndexRaw].data)
    : undefined;
  // Same fallback chain as distillRunEvents: stream first, then external harness.
  const verification = streamVerification ?? options?.verification;
  const streamVerified = streamVerification !== undefined;
  const sequenceEnd = verificationIndexRaw >= 0 ? verificationIndexRaw : events.length;
  const operationIndices = events
    .map((event, index) => ({ event, index }))
    .filter(({ event, index }) => index > errorIndex && index < sequenceEnd && isToolCall(event.data))
    .map(({ index }) => index);
  if (operationIndices.length === 0) return null;

  if (verification) {
    return {
      errorIndex,
      verificationIndex: verificationIndexRaw >= 0 ? verificationIndexRaw : undefined,
      verification,
      operationIndices,
      provisional: false,
      streamVerified,
    };
  }
  if (!options?.allowProvisional) return null;
  return {
    errorIndex,
    verificationIndex: undefined,
    verification: undefined,
    operationIndices,
    provisional: true,
    streamVerified: false,
  };
}

export function detectVerification(event: Record<string, unknown>): VerificationKind | undefined {
  if (num(event.exitCode) === 0 || num(event.exit_code) === 0) return 'exit 0';
  if (num(event.reward) === 1 || num(event.correctnessScore) === 1) return 'verifier reward=1';
  const verifier = isRecord(event.verifier) ? event.verifier : undefined;
  if (!verifier) return undefined;
  if (num(verifier.reward) === 1 || num(verifier.correctnessScore) === 1) return 'verifier reward=1';
  if (num(verifier.exitCode) === 0 || num(verifier.exit_code) === 0) return 'exit 0';
  return undefined;
}

export function isErrorEvent(event: Record<string, unknown>): boolean {
  const kind = str(event.kind) ?? str(event.type) ?? '';
  return kind.includes('error') || event.isError === true;
}

export function isToolCall(event: Record<string, unknown>): boolean {
  const kind = str(event.kind) ?? str(event.type) ?? '';
  return kind === 'tool_call' || kind === 'tool-call';
}

export interface CitedEvidence {
  errorToolCallId: string;
  fixToolCallIds: string[];
  verificationToolCallId: string;
}

export type CitedEvidenceAudit = { ok: true } | { ok: false; reason: string };

/**
 * Verify a cited error/fix/verification triple against the event stream.
 * Unlike findCausalPair (first-error search for distill/template), this looks
 * up the cited ids and checks predicates on those events only.
 */
export function auditCitedEvidence(
  rawEvents: Array<CausalPairEvent | Record<string, unknown>>,
  evidence: CitedEvidence,
): CitedEvidenceAudit {
  if (evidence.fixToolCallIds.length === 0) {
    return { ok: false, reason: 'empty fixToolCallIds' };
  }

  const events = asCausalEvents(rawEvents);
  const indexed = events.map((event, index) => {
    const raw = rawEvents[index];
    const rawRecord = isRecord(raw) ? raw : undefined;
    return {
      id: (rawRecord ? extractEventId(rawRecord) : undefined) ?? extractEventId(event.data),
      data: event.data,
    };
  });

  const errorId = str(evidence.errorToolCallId);
  if (!errorId) return { ok: false, reason: 'missing errorToolCallId' };
  const errorEvent = indexed.find((event) => event.id === errorId);
  if (!errorEvent) return { ok: false, reason: `missing error event: ${errorId}` };
  if (!isErrorEvent(errorEvent.data)) {
    return { ok: false, reason: `cited error event is not an error: ${errorId}` };
  }

  for (const rawFixId of evidence.fixToolCallIds) {
    const fixId = str(rawFixId);
    if (!fixId) return { ok: false, reason: 'missing fix event: (empty id)' };
    const fixEvent = indexed.find((event) => event.id === fixId);
    if (!fixEvent) return { ok: false, reason: `missing fix event: ${fixId}` };
  }

  const verificationId = str(evidence.verificationToolCallId);
  if (!verificationId) return { ok: false, reason: 'missing verificationToolCallId' };
  const verificationEvent = indexed.find((event) => event.id === verificationId);
  if (!verificationEvent) {
    return { ok: false, reason: `missing verification event: ${verificationId}` };
  }
  if (detectVerification(verificationEvent.data) === undefined) {
    return { ok: false, reason: `cited verification event is not green: ${verificationId}` };
  }

  const errorIndex = indexed.findIndex((event) => event.id === errorId);
  const fixIndices = evidence.fixToolCallIds.map((rawFixId) =>
    indexed.findIndex((event) => event.id === str(rawFixId)));
  const verificationIndex = indexed.findIndex((event) => event.id === verificationId);
  if (
    errorIndex < 0
    || verificationIndex < 0
    || fixIndices.some((index) => index < 0)
    || fixIndices.some((index) => index <= errorIndex)
    || fixIndices.some((index) => index >= verificationIndex)
  ) {
    return { ok: false, reason: 'out-of-order' };
  }

  return { ok: true };
}

/** Resolve a cited event id: toolCallId → id → metadata.evidenceRef, then nested data. */
export function extractEventId(event: Record<string, unknown>): string | undefined {
  const metadata = isRecord(event.metadata) ? event.metadata : undefined;
  const nested = isRecord(event.data) ? event.data : undefined;
  const nestedMeta = nested && isRecord(nested.metadata) ? nested.metadata : undefined;
  return str(event.toolCallId)
    ?? str(event.id)
    ?? (metadata ? str(metadata.evidenceRef) : undefined)
    ?? (nested ? str(nested.toolCallId) : undefined)
    ?? (nested ? str(nested.id) : undefined)
    ?? (nestedMeta ? str(nestedMeta.evidenceRef) : undefined);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
