import { COMMAND_COMPLETIONS } from '../cli/command-parser.js';

export function getCommandCompletions(inputValue: string, limit = 10): string[] {
  if (!inputValue.startsWith('/')) return [];
  return COMMAND_COMPLETIONS
    .filter((command) => command.startsWith(inputValue))
    .slice(0, limit);
}
