import type { ErrorCategory } from './types.js';
import { truncateRawError } from './types.js';
import { ToolExecutionError } from '../executor/types.js';

export interface ClassifiedError {
  category: ErrorCategory;
  subtype: string;
  message: string;
  stack?: string;
  causeName?: string;
}

const ENV_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']);
const ENV_HTTP_RE = /\b(401|403|407|429)\b/;
const TOOL_SELECTOR_RE = /selector|element not found|node is detached|locator/i;
const TOOL_TIMEOUT_RE = /timeout (waiting|exceeded)|timed out waiting/i;
const TOOL_NOTFOUND_RE = /not found|404|ENOENT/i;
const TOOL_EDIT_EXACT_TEXT_RE = /Could not find (the exact text|edits\[\d+\]).*oldText must match exactly|old text must match exactly/i;
const MODEL_JSON_RE = /JSON|unexpected token|invalid schema|parse error/i;
const USER_INPUT_RE = /ambiguous|需要澄清|task unclear|__user_input_error__/i;
const STATE_CONFLICT_RE = /conflict|ECONFLICT|__state_conflict__/i;

function causeString(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

export function classifyError(err: unknown, toolName?: string): ClassifiedError {
  const toolExecErr = err instanceof ToolExecutionError ? err : null;
  const cause = toolExecErr?.cause ?? (err instanceof Error ? (err.cause as unknown) : null);
  const causeStr = cause !== null && cause !== undefined ? causeString(cause) : '';
  const msg = err instanceof Error ? err.message : String(err);
  const stack =
    err instanceof Error && err.stack ? truncateRawError(err.stack) : undefined;
  const causeName = cause instanceof Error ? cause.name : undefined;

  const text = `${msg} ${causeStr}`;

  // 1. state conflict (check before env to avoid misclassification)
  if (STATE_CONFLICT_RE.test(text)) {
    return { category: 'state_conflict', subtype: 'conflict', message: msg, stack, causeName };
  }

  // 2. environment
  if (
    ENV_HTTP_RE.test(text) ||
    (cause instanceof Error && ENV_CODES.has((cause as NodeJS.ErrnoException).code ?? ''))
  ) {
    const subtype = ENV_HTTP_RE.exec(text)?.[1] === '401' || ENV_HTTP_RE.exec(text)?.[1] === '403'
      ? 'auth-expired'
      : 'network-unreachable';
    return { category: 'environment', subtype, message: msg, stack, causeName };
  }

  // 3. user_input
  if (USER_INPUT_RE.test(text)) {
    return { category: 'user_input', subtype: 'ambiguous-task', message: msg, stack, causeName };
  }

  // 4. model error (JSON/schema)
  if (MODEL_JSON_RE.test(text)) {
    return { category: 'model', subtype: 'json-parse', message: msg, stack, causeName };
  }

  // 5. tool — selector / timeout / not-found
  if (TOOL_SELECTOR_RE.test(text)) {
    return { category: 'tool', subtype: 'selector-not-found', message: msg, stack, causeName };
  }
  if (TOOL_TIMEOUT_RE.test(text)) {
    return { category: 'tool', subtype: 'timeout', message: msg, stack, causeName };
  }
  if (TOOL_EDIT_EXACT_TEXT_RE.test(text)) {
    return { category: 'tool', subtype: 'edit-exact-text-mismatch', message: msg, stack, causeName };
  }
  if (TOOL_NOTFOUND_RE.test(text) && toolName) {
    return { category: 'tool', subtype: 'resource-not-found', message: msg, stack, causeName };
  }

  // default
  return { category: 'tool', subtype: 'unknown', message: msg, stack, causeName };
}
