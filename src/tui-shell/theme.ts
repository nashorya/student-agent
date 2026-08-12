import chalk from 'chalk';
import type { EditorTheme } from '@earendil-works/pi-tui';

/** Semantic color tokens — calm cyan/gray palette (no purple glow). */
export const theme = {
  text: (s: string) => chalk.white(s),
  muted: (s: string) => chalk.gray(s),
  accent: (s: string) => chalk.cyan(s),
  border: (s: string) => chalk.dim.gray(s),
  success: (s: string) => chalk.green(s),
  warning: (s: string) => chalk.yellow(s),
  danger: (s: string) => chalk.red(s),
  reasoning: (s: string) => chalk.dim.cyan(s),
  tool: (s: string) => chalk.blue(s),
  selected: (s: string) => chalk.bgGray.white(s),
  diffAdded: (s: string) => chalk.green(s),
  diffRemoved: (s: string) => chalk.red(s),
  memory: (s: string) => chalk.dim.blue(s),
  agent: (s: string) => chalk.cyanBright(s),
} as const;

export type ThemeToken = keyof typeof theme;

export const editorTheme: EditorTheme = {
  borderColor: theme.border,
  selectList: {
    selectedPrefix: (text) => theme.accent(text),
    selectedText: (text) => theme.accent(text),
    description: (text) => theme.muted(text),
    scrollInfo: (text) => theme.muted(text),
    noMatch: (text) => theme.warning(text),
  },
};
