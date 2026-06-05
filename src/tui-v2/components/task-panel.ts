import { fitLine } from './status.js';
import { visibleLength } from '../terminal-control.js';
import type { TUIV2PhaseInfo } from '../events.js';
import type { TUIV2TaskPanelState } from '../state.js';

// ANSI helpers
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

export function renderTaskPanelLines(
  taskPanel: TUIV2TaskPanelState | null,
  width: number,
): string[] {
  if (!taskPanel || (!taskPanel.name && !taskPanel.state)) return [];

  const lines: string[] = [];

  // ── Header line ─────────────────────────────────────────
  const name = taskPanel.name ? BOLD + taskPanel.name + RESET : DIM + '[task]' + RESET;
  const stateTag = formatStateTag(taskPanel.state);
  const retry = taskPanel.retryCount && taskPanel.retryCount > 0
    ? DIM + ` · retry ${taskPanel.retryCount}` + RESET : '';
  const tools = taskPanel.toolCallCount && taskPanel.toolCallCount > 0
    ? DIM + ` · ${taskPanel.toolCallCount} tools` + RESET : '';

  const headerPlain = [
    taskPanel.name ?? '[task]',
    taskPanel.state ?? '',
    taskPanel.retryCount && taskPanel.retryCount > 0 ? `· retry ${taskPanel.retryCount}` : '',
    taskPanel.toolCallCount && taskPanel.toolCallCount > 0 ? `· ${taskPanel.toolCallCount} tools` : '',
  ].filter(Boolean).join(' ');

  // Build header with colors, padded to width
  const headerColored = `${name} ${stateTag}${retry}${tools}`;
  const headerPad = Math.max(0, width - visibleLength(headerPlain));
  lines.push(headerColored + ' '.repeat(headerPad));

  // ── Phase checklist ──────────────────────────────────────
  if (taskPanel.phases && taskPanel.phases.length > 0) {
    for (let i = 0; i < taskPanel.phases.length; i++) {
      const phase = taskPanel.phases[i]!;
      const isActive = i === taskPanel.phaseIndex;
      const line = renderPhaseLine(i, phase, isActive, width);
      lines.push(line);
    }
  }

  // ── Review warning ───────────────────────────────────────
  const reviewLine = formatReviewLine(taskPanel);
  if (reviewLine) lines.push(fitLine(reviewLine, width));

  return lines;
}

function renderPhaseLine(
  index: number,
  phase: TUIV2PhaseInfo,
  isActive: boolean,
  width: number,
): string {
  const { icon, color } = phaseStyle(phase.status, isActive);
  const prefix = `  ${icon} `;
  const prefixPlain = `  ${stripAnsi(icon)} `;
  const descWidth = Math.max(1, width - visibleLength(prefixPlain));

  // Truncate description if needed
  let desc = phase.description;
  if (visibleLength(desc) > descWidth) {
    let out = '';
    for (const ch of Array.from(desc)) {
      if (visibleLength(out + ch + '…') > descWidth) break;
      out += ch;
    }
    desc = out + '…';
  }

  const styledDesc = color + desc + RESET;
  const fullLine = prefix + styledDesc;
  const padLen = Math.max(0, width - visibleLength(prefixPlain) - visibleLength(desc));
  return fullLine + ' '.repeat(padLen);
}

function phaseStyle(
  status: TUIV2PhaseInfo['status'],
  isActive: boolean,
): { icon: string; color: string } {
  switch (status) {
    case 'completed': return { icon: GREEN + '●' + RESET, color: DIM };
    case 'in_progress': return { icon: YELLOW + '◆' + RESET, color: YELLOW };
    case 'blocked':  return { icon: RED + '✖' + RESET, color: RED };
    case 'skipped':  return { icon: DIM + '─' + RESET, color: DIM };
    case 'pending':
    default:
      return isActive
        ? { icon: CYAN + '◇' + RESET, color: CYAN }
        : { icon: DIM + '○' + RESET, color: DIM };
  }
}

function formatStateTag(state: string | undefined): string {
  if (!state) return '';
  switch (state) {
    case 'running':  return CYAN + 'running' + RESET;
    case 'aborting': return YELLOW + 'aborting' + RESET;
    case 'failed':   return RED + 'failed' + RESET;
    case 'idle':     return DIM + 'idle' + RESET;
    default:         return DIM + state + RESET;
  }
}

function formatReviewLine(taskPanel: TUIV2TaskPanelState): string | null {
  const markers = [
    taskPanel.requiresVisualReview ? 'visual review required' : null,
    taskPanel.requiresUserAcceptance ? 'user acceptance required' : null,
  ].filter((marker): marker is string => Boolean(marker));
  if (markers.length === 0) return null;
  return YELLOW + `  ⚠ ${markers.join(' · ')}` + RESET;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}
