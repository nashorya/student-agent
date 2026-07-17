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
  verificationIndex: number | undefined;
  verification: VerificationKind;
  operationIndices: number[];
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

/** First error → first verification after it; requires ≥1 tool_call in between. */
export function findCausalPair(
  rawEvents: Array<CausalPairEvent | Record<string, unknown>>,
  options?: { verification?: VerificationKind },
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
  const verification = streamVerification ?? options?.verification;
  if (!verification) return null;

  const sequenceEnd = verificationIndexRaw >= 0 ? verificationIndexRaw : events.length;
  const operationIndices = events
    .map((event, index) => ({ event, index }))
    .filter(({ event, index }) => index > errorIndex && index < sequenceEnd && isToolCall(event.data))
    .map(({ index }) => index);
  if (operationIndices.length === 0) return null;

  return {
    errorIndex,
    verificationIndex: verificationIndexRaw >= 0 ? verificationIndexRaw : undefined,
    verification,
    operationIndices,
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

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
