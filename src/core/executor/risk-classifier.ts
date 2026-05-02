import type { RiskLevel } from './types.js';

export const HIGH_RISK_TOOL_PATTERN = /^(delete|rm|unlink|drop_)/;
export const HIGH_RISK_TOOL_SUFFIX = /_destroy/;

// matches string patterns only — does not cover shell variable expansion or aliases.
export const HIGH_RISK_BASH_PATTERNS: RegExp[] = [
  /rm -r/,
  /DROP TABLE/,
  /DELETE FROM/,
  /> \//,
  /mv .*\/dev\/null/,
];

export function classify(toolName: string, input: Record<string, unknown>): RiskLevel {
  if (HIGH_RISK_TOOL_PATTERN.test(toolName) || HIGH_RISK_TOOL_SUFFIX.test(toolName)) {
    return 'high';
  }

  if (toolName === 'bash') {
    const command = input['command'];
    if (typeof command === 'string') {
      // matches string patterns only — does not cover shell variable expansion or aliases.
      for (const pattern of HIGH_RISK_BASH_PATTERNS) {
        if (pattern.test(command)) {
          return 'high';
        }
      }
    }
  }

  if (
    toolName.includes('db_write') ||
    toolName.includes('sql_exec') ||
    toolName.includes('migrate')
  ) {
    return 'high';
  }

  return 'low';
}
