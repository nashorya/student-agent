import type { Component } from '@earendil-works/pi-tui';
import { Text } from '@earendil-works/pi-tui';
import { theme } from './theme.js';
import type { ShellState } from './state.js';
import { isWide } from './layout.js';

const ANSI_RE = /\u001b\[[0-9;]*m/g;

/** Visible width without ANSI escapes. */
export function visibleWidth(text: string): number {
  return text.replace(ANSI_RE, '').length;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** Full-width horizontal rule. */
export function hRule(width: number): string {
  const w = Math.max(1, width);
  return theme.border('─'.repeat(w));
}

/**
 * Section title with rail decoration: `── Plan ────────`
 * Keeps title readable; fills remainder with rule.
 */
export function sectionRailTitle(title: string, width: number): string {
  const w = Math.max(8, width);
  const label = ` ${title} `;
  const left = '──';
  const used = left.length + label.length;
  const rightLen = Math.max(2, w - used);
  return theme.border(left) + theme.title(label) + theme.border('─'.repeat(rightLen));
}

/** Prefix each content line with a quiet left rail for sidebar panels. */
export function withSidebarRail(lines: string[], width: number): string[] {
  const rail = theme.border('│ ');
  const inner = Math.max(1, width - 2);
  const out: string[] = [];
  for (const line of lines) {
    const plain = stripAnsi(line);
    if (plain.length <= inner) {
      out.push(rail + line);
      continue;
    }
    const chunks = new Text(line, 1, 0).render(inner);
    for (const chunk of chunks) {
      out.push(rail + chunk);
    }
  }
  return out;
}

/**
 * Wrap an entire sidebar column so every row shares one continuous left seam.
 * Makes Plan/Subagents read as one panel, not floating text.
 */
export class SidebarFrame implements Component {
  constructor(private readonly inner: Component) {}

  invalidate(): void {
    this.inner.invalidate?.();
  }

  render(width: number): string[] {
    const rail = theme.border('│ ');
    const innerW = Math.max(1, width - 2);
    const lines = this.inner.render(innerW);
    if (lines.length === 0) {
      return [rail + theme.faint(' ')];
    }
    return lines.map((line) => {
      const plain = stripAnsi(line);
      if (plain.length === 0) return rail;
      return rail + line;
    });
  }
}

export class HRule implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    return [hRule(width)];
  }
}

/** Product chrome — brand left, live summary right. Not a log line. */
export class WorkspaceHeader implements Component {
  constructor(
    private readonly getState: () => ShellState,
    private readonly getMeta: () => { model?: string; mode?: string },
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.getState();
    const meta = this.getMeta();
    const brand = theme.accent('Student Agent');

    const statusBits: string[] = [];
    if (meta.mode) statusBits.push(meta.mode);
    if (meta.model) statusBits.push(meta.model);

    let live = 'ready';
    if (state.statusText) live = state.statusText;
    else if (state.currentTool) live = `tool:${state.currentTool}`;
    else if (state.taskStatus?.state) live = String(state.taskStatus.state);
    else if (state.streamingAssistantId || state.streamingReasoningId) live = 'live';
    statusBits.push(live);

    const right = theme.muted(statusBits.join(' · '));
    const gap = 2;
    const brandPlain = 'Student Agent';
    const rightPlain = statusBits.join(' · ');
    const space = Math.max(1, width - brandPlain.length - rightPlain.length - gap);
    const row = brand + ' '.repeat(space) + right;

    if (brandPlain.length + gap + rightPlain.length > width) {
      return [theme.accent(brandPlain.slice(0, width)), hRule(width)];
    }
    return [row, hRule(width)];
  }
}

/** Quiet label above the editor so the compose dock reads as its own region. */
export class ComposerLabel implements Component {
  constructor(private readonly getState: () => ShellState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const answering = this.getState().statusText.includes('answering prompt');
    const hint = answering
      ? theme.warning('Ask  ›  reply below')
      : theme.accent('Compose') + theme.muted('  ›  message or /command');
    return [hint];
  }
}

/** Status dock: rule + compact full-width bar (application chrome). */
export class StatusBar implements Component {
  constructor(
    private readonly getState: () => ShellState,
    private readonly getMeta: () => { model?: string; mode?: string },
    private readonly getColumns: () => number,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.getState();
    const meta = this.getMeta();

    let status = 'ready';
    if (state.statusText) status = state.statusText;
    else if (state.taskStatus?.state) {
      const ts = state.taskStatus;
      status = ts.name ? `${ts.state}:${ts.name}` : String(ts.state);
    } else if (state.currentTool) {
      status = `tool:${state.currentTool}`;
    } else if (state.streamingAssistantId || state.streamingReasoningId) {
      status = 'live';
    }

    const groups: string[] = [
      theme.accent(status),
      meta.mode ? theme.muted(meta.mode) : '',
      meta.model ? theme.muted(meta.model) : '',
    ].filter(Boolean);

    if (state.pendingCount > 0) {
      groups.push(theme.faint(`queued:${state.pendingCount}`));
    }

    if (!isWide(this.getColumns())) {
      const done = state.planSteps.filter((s) => s.status === 'done').length;
      const planHint = state.planSteps.length > 0
        ? `plan ${done}/${state.planSteps.length}`
        : 'plan —';
      groups.push(theme.faint(planHint));
      if (state.compactOverlay !== 'none') {
        groups.push(theme.faint(state.compactOverlay));
      }
    }

    const sep = theme.faint('  ·  ');
    let line = groups.join(sep);
    const plain = stripAnsi(line);
    if (plain.length > width) {
      line = theme.muted(plain.slice(0, Math.max(0, width - 1)) + '…');
    }
    // No bgHex — Windows Terminal often ghosts a corrupted line under bg fills.
    return [hRule(width), line];
  }
}
