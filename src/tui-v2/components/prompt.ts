import { getPromptPanelLines } from './input.js';
import { fitLine } from './status.js';
import type { TUIV2State } from '../state.js';

export function renderPromptLines(state: TUIV2State, width: number): string[] {
  return getPromptPanelLines(state).map((line) => fitLine(line, width));
}
