import type { RiskLevel } from './types.js';

export const HIGH_RISK_TOOL_PATTERN = /^(delete|rm|unlink|drop)(?:[_-]|$)/i;
export const HIGH_RISK_TOOL_DESTROY_PATTERN = /(?:^|[_-])destroy(?:[_-]|$)|_destroy/i;

// Pattern matching is intentionally conservative; it is not a shell parser.
export const HIGH_RISK_BASH_PATTERNS: RegExp[] = [
  /\b(drop|truncate)\s+(table|database|schema)\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table\b[\s\S]*\bdrop\b/i,
  /\brm\s+(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive\b)/i,
  /\bfind\b[\s\S]*\s-delete\b/i,
  /(?:^|\s)(?:\d*)>>?\s*["']?\/(?:etc|bin|sbin|usr|var|boot|dev|root|System|Library)\b/i,
  /(?:^|\s)&>\s*["']?\/(?:etc|bin|sbin|usr|var|boot|dev|root|System|Library)\b/i,
  /\btee\s+(?:-a\s+)?["']?\/(?:etc|bin|sbin|usr|var|boot|dev|root|System|Library)\b/i,
  /\bmv\b[\s\S]*\s\/dev\/null\b/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b/i,
  /\b(dd|mkfs(?:\.\w+)?)\b/i,
  /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
  /\bgit\s+(?:reset\s+--hard|clean\s+-[A-Za-z]*[fd][A-Za-z]*|restore\b|checkout\s+--(?:\s|$))/i,
  /\bkubectl\b[\s\S]*\b(delete|delete-all|drain)\b/i,
  /\baws\b[\s\S]*\b(delete|remove|terminate-instances|detach|destroy)\b/i,
  /\bgcloud\b[\s\S]*\b(delete|remove|destroy)\b/i,
  /\bdocker\b[\s\S]*\b(rm|rmi|system\s+prune|volume\s+rm|network\s+rm)\b/i,
];

const SHELL_TOOL_NAMES = new Set(['bash', 'shell', 'terminal', 'exec_command']);

export function classify(toolName: string, input: unknown): RiskLevel {
  const normalizedToolName = toolName.trim().toLowerCase();

  if (HIGH_RISK_TOOL_PATTERN.test(normalizedToolName) || HIGH_RISK_TOOL_DESTROY_PATTERN.test(normalizedToolName)) {
    return 'high';
  }

  if (SHELL_TOOL_NAMES.has(normalizedToolName)) {
    const command = extractCommand(input);
    if (command) {
      for (const pattern of HIGH_RISK_BASH_PATTERNS) {
        if (pattern.test(command)) return 'high';
      }
    }
  }

  if (
    normalizedToolName.includes('db_write') ||
    normalizedToolName.includes('sql_exec') ||
    normalizedToolName.includes('migrate')
  ) {
    return 'high';
  }

  return 'low';
}

function extractCommand(input: unknown): string | null {
  if (typeof input === 'string') {
    return input.trim() || null;
  }
  if (!isRecord(input)) {
    return null;
  }
  for (const key of ['cmd', 'command', 'script']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
