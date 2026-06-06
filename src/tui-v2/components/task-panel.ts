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

  // Progress indicator: "3/5" when phases available
  const phases = taskPanel.phases ?? [];
  const total = phases.length || taskPanel.totalPhases;
  const done = phases.filter((p) => p.status === 'completed').length;
  const progressStr = total && total > 0
    ? DIM + ` ${done}/${total}` + RESET
    : '';
  const progressPlain = total && total > 0 ? ` ${done}/${total}` : '';

  const retry = taskPanel.retryCount && taskPanel.retryCount > 0
    ? DIM + ` · retry ${taskPanel.retryCount}` + RESET : '';
  const retryPlain = taskPanel.retryCount && taskPanel.retryCount > 0
    ? ` · retry ${taskPanel.retryCount}` : '';

  const namePlain = taskPanel.name ?? '[task]';
  const statePlain = taskPanel.state ?? '';
  // Build headerPlain mirroring headerColored: `${name} ${state}${progress}${retry}`
  const headerPlain = namePlain + (statePlain ? ' ' + statePlain : '') + progressPlain + retryPlain;

  const headerColored = `${name} ${stateTag}${progressStr}${retry}`;
  const headerPad = Math.max(0, width - visibleLength(headerPlain));
  lines.push(headerColored + ' '.repeat(headerPad));

  // ── Phase checklist ──────────────────────────────────────
  if (phases.length > 0) {
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i]!;
      const isActive = i === (taskPanel.phaseIndex ?? -1);
      const line = renderPhaseLine(phase, isActive, width);
      lines.push(line);
    }
  }

  // ── Review / acceptance warning ──────────────────────────
  const reviewLine = formatReviewLine(taskPanel);
  if (reviewLine) lines.push(fitLine(reviewLine, width));

  return lines;
}

function renderPhaseLine(
  phase: TUIV2PhaseInfo,
  isActive: boolean,
  width: number,
): string {
  const { icon, color, iconPlain } = phaseStyle(phase.status, isActive);
  const prefix = `  ${icon} `;
  const prefixPlain = `  ${iconPlain} `;
  const descWidth = Math.max(1, width - visibleLength(prefixPlain));

  // Choose long or short description based on phase state
  const rawDesc = isActive || phase.status === 'in_progress'
    ? phase.description                        // full text for active
    : shortTitle(phase.description);            // short title for done/pending

  // Truncate if still too wide
  let desc = rawDesc;
  if (visibleLength(desc) > descWidth) {
    let out = '';
    for (const ch of Array.from(desc)) {
      if (visibleLength(out + ch + '…') > descWidth) break;
      out += ch;
    }
    desc = out + '…';
  }

  const styledDesc = color + desc + RESET;
  const padLen = Math.max(0, width - visibleLength(prefixPlain) - visibleLength(desc));
  return prefix + styledDesc + ' '.repeat(padLen);
}

/**
 * Extract a short title from a long phase description.
 * Splits on ' – ', ' - ', or ': ' and takes the first segment.
 * Falls back to first 20 chars if no separator found.
 */
function shortTitle(desc: string): string {
  // Try Chinese dash (–) or ASCII dash surrounded by spaces
  const dashMatch = /^(.+?)(?:\s+[–—-]\s+|\s*：\s*|\s*:\s+)/.exec(desc);
  if (dashMatch && dashMatch[1]) {
    return dashMatch[1].trim();
  }
  // Try "动词+名词" pattern: grab up to first comma or period
  const commaMatch = /^([^，。,]{1,25})/.exec(desc);
  if (commaMatch) return commaMatch[1].trim();
  return desc;
}

function phaseStyle(
  status: TUIV2PhaseInfo['status'],
  isActive: boolean,
): { icon: string; color: string; iconPlain: string } {
  switch (status) {
    case 'completed':
      return { icon: GREEN + '✓' + RESET, color: DIM, iconPlain: '✓' };
    case 'in_progress':
      return { icon: YELLOW + '◆' + RESET, color: YELLOW, iconPlain: '◆' };
    case 'blocked':
      return { icon: RED + '✖' + RESET, color: RED, iconPlain: '✖' };
    case 'skipped':
      return { icon: DIM + '─' + RESET, color: DIM, iconPlain: '─' };
    case 'pending':
    default:
      return isActive
        ? { icon: CYAN + '◆' + RESET, color: CYAN, iconPlain: '◆' }
        : { icon: DIM + '○' + RESET, color: DIM, iconPlain: '○' };
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
  const markers: string[] = [];
  if (taskPanel.requiresVisualReview) markers.push('视觉验收');
  if (taskPanel.requiresUserAcceptance) markers.push('待用户验收');
  if (markers.length === 0) return null;
  return YELLOW + `  ★ ${markers.join(' · ')}` + RESET;
}
