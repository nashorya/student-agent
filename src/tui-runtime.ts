import { startTUI as startLegacyTUI, isTTY, type TUIHandle } from './tui/index.js';
import { startTUIV2 } from './tui-v2/index.js';

export type TUIVersion = 'v1' | 'v2';

export interface TUIVersionEnv {
  STUDENT_AGENT_TUI?: string;
}

export function selectTUIVersion(
  env: TUIVersionEnv,
): TUIVersion {
  return env.STUDENT_AGENT_TUI === 'v1' ? 'v1' : 'v2';
}

export function shouldPrintLegacyBanner(env: TUIVersionEnv): boolean {
  return selectTUIVersion(env) === 'v1';
}

export function startSelectedTUI(options: {
  onSubmit: (value: string) => void;
  onAbort: () => void;
  onExit?: () => void;
}): TUIHandle {
  return selectTUIVersion(process.env) === 'v2'
    ? startTUIV2(options)
    : startLegacyTUI(options);
}

export { isTTY };
