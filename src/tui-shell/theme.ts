import chalk from 'chalk';
import type { EditorTheme } from '@earendil-works/pi-tui';

/**
 * Semantic tokens for a calm developer workspace.
 * Body text must stay readable on black (avoid dim.gray for content).
 */
export const theme = {
  text: (s: string) => chalk.whiteBright(s),
  muted: (s: string) => chalk.gray(s),
  faint: (s: string) => chalk.dim.gray(s),
  accent: (s: string) => chalk.cyan(s),
  title: (s: string) => chalk.bold.whiteBright(s),
  border: (s: string) => chalk.dim.gray(s),
  success: (s: string) => chalk.green(s),
  warning: (s: string) => chalk.yellow(s),
  danger: (s: string) => chalk.red(s),
  reasoning: (s: string) => chalk.gray(s),
  tool: (s: string) => chalk.blueBright(s),
  selected: (s: string) => chalk.bgGray.whiteBright(s),
  diffAdded: (s: string) => chalk.green(s),
  diffRemoved: (s: string) => chalk.red(s),
  memory: (s: string) => chalk.yellow(s),
  agent: (s: string) => chalk.cyan(s),
  statusBg: (s: string) => chalk.bgHex('#1a1a1a')(s),
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
