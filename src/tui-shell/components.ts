import type { Component } from '@earendil-works/pi-tui';
import { Text } from '@earendil-works/pi-tui';
import type { ActivityKind, ShellMessage, ShellState } from './state.js';
import { theme } from './theme.js';
import { isWide } from './layout.js';
import { sortAgentRowsForTree } from './project-workbench.js';

const DIFF_LINE_RE = /^(?:diff --git |@@ |[+-](?![+-]))/;

function kindStyle(kind: ActivityKind): (s: string) => string {
  switch (kind) {
    case 'user':
      return theme.accent;
    case 'assistant':
      return theme.text;
    case 'reasoning':
      return theme.reasoning;
    case 'tool':
      return theme.tool;
    case 'diff':
      return theme.text;
    case 'system':
      return theme.muted;
    case 'prompt':
      return theme.warning;
    case 'error':
      return theme.danger;
    case 'recovery':
      return theme.warning;
    case 'verification':
      return theme.success;
    case 'signal':
    case 'reflect':
    case 'recall':
      return theme.memory;
    default:
      return theme.text;
  }
}

function kindLabel(kind: ActivityKind, meta?: ShellMessage['meta']): string {
  switch (kind) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'reasoning':
      return 'Thinking';
    case 'tool': {
      const status = meta?.toolStatus;
      if (status === 'running') return 'Tool ·';
      if (status === 'failed') return 'Tool ✗';
      if (status === 'done') return 'Tool ✓';
      return 'Tool';
    }
    case 'diff':
      return 'Diff';
    case 'system':
      return 'System';
    case 'prompt':
      return 'Ask';
    case 'error':
      return 'Error';
    case 'recovery':
      return 'Recovery';
    case 'verification':
      return 'Verify';
    case 'signal':
      return 'Signal';
    case 'reflect':
      return 'Reflect';
    case 'recall':
      return 'Recall';
    default:
      return kind;
  }
}

function looksLikeDiff(content: string): boolean {
  const lines = content.split('\n').slice(0, 40);
  let hits = 0;
  for (const line of lines) {
    if (DIFF_LINE_RE.test(line)) hits += 1;
  }
  return hits >= 2;
}

function renderDiffBody(content: string, width: number): string[] {
  const lines: string[] = [];
  for (const raw of content.split('\n')) {
    let painted = raw;
    if (raw.startsWith('+') && !raw.startsWith('+++')) painted = theme.diffAdded(raw);
    else if (raw.startsWith('-') && !raw.startsWith('---')) painted = theme.diffRemoved(raw);
    else if (raw.startsWith('@@')) painted = theme.muted(raw);
    else painted = theme.muted(raw);
    lines.push(...new Text(painted, 1, 0).render(width));
  }
  return lines;
}

function renderActivity(msg: ShellMessage, width: number): string[] {
  const style = kindStyle(msg.kind);
  const label = style(kindLabel(msg.kind, msg.meta));
  const body = msg.content.length > 0 ? msg.content : theme.muted('…');

  if (msg.kind === 'reasoning') {
    const indented = body
      .split('\n')
      .map((line) => theme.reasoning(`  ${line}`))
      .join('\n');
    return new Text(`${label}\n${indented}`, 1, 0).render(width);
  }

  if (msg.kind === 'tool') {
    return new Text(`${label} ${theme.tool(body)}`, 1, 0).render(width);
  }

  if (msg.kind === 'diff' || (msg.kind === 'assistant' && looksLikeDiff(msg.content))) {
    const header = style(msg.kind === 'diff' ? 'Diff:' : 'Assistant:');
    return [header, ...renderDiffBody(msg.content, width), ''];
  }

  if (msg.kind === 'user' || msg.kind === 'assistant') {
    return new Text(`${label}: ${body}`, 1, 0).render(width);
  }

  return new Text(`${label}: ${body}`, 1, 0).render(width);
}

/** Phase 2 transcript: hierarchical activity timeline. */
export class TranscriptView implements Component {
  constructor(private readonly getState: () => ShellState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const { messages } = this.getState();
    if (messages.length === 0) {
      return new Text(theme.muted('Transcript empty — type a prompt below.'), 1, 0).render(width);
    }

    const lines: string[] = [];
    for (const msg of messages) {
      lines.push(...renderActivity(msg, width));
      if (msg.kind !== 'tool') {
        lines.push('');
      }
    }
    return lines;
  }
}

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
    const parts: string[] = [];

    if (state.statusText) {
      parts.push(state.statusText);
    } else if (state.taskStatus?.state) {
      const ts = state.taskStatus;
      const name = ts.name ? ` ${ts.name}` : '';
      parts.push(`${ts.state}${name}`);
    } else if (state.currentTool) {
      parts.push(`tool: ${state.currentTool}`);
    } else {
      parts.push('ready');
    }

    if (meta.mode) parts.push(meta.mode);
    if (meta.model) parts.push(meta.model);
    if (state.pendingCount > 0) parts.push(`queued:${state.pendingCount}`);

    if (!isWide(this.getColumns())) {
      const planHint =
        state.planSteps.length > 0
          ? `Plan: ${state.planSteps.filter((s) => s.status === 'done').length}/${state.planSteps.length}`
          : 'Plan: n/a';
      parts.push(planHint);
      if (state.compactOverlay !== 'none') {
        parts.push(`overlay:${state.compactOverlay}`);
      } else {
        parts.push('Ctrl+P overlay');
      }
    }

    const line = theme.muted(parts.join(' · '));
    if (line.length <= width) return [line];
    const visible = Math.max(0, width - 1);
    return [line.slice(0, visible) + '…'];
  }
}

export class PlanPanel implements Component {
  constructor(private readonly getState: () => ShellState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const steps = this.getState().planSteps;
    const header = theme.accent('Plan');
    if (steps.length === 0) {
      return new Text(`${header}\n${theme.muted('No plan yet')}`, 1, 0).render(width);
    }
    const body = steps
      .map((step) => {
        const mark =
          step.status === 'done' ? theme.success('✓') :
          step.status === 'active' ? theme.accent('●') :
          theme.muted('○');
        return `${mark} ${step.title}`;
      })
      .join('\n');
    return new Text(`${header}\n${body}`, 1, 0).render(width);
  }
}

export class AgentsPanel implements Component {
  constructor(private readonly getState: () => ShellState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const agents = sortAgentRowsForTree(this.getState().agents);
    const header = theme.agent('Subagents');
    if (agents.length === 0) {
      return new Text(`${header}\n${theme.muted('No subagents')}`, 1, 0).render(width);
    }
    const body = agents
      .map((agent) => {
        const mark =
          agent.status === 'done' ? theme.success('✓') :
          agent.status === 'failed' ? theme.danger('✗') :
          theme.accent('●');
        const indent = agent.parentId ? theme.muted('└─ ') : '';
        const summary = agent.summary ? theme.muted(` — ${agent.summary}`) : '';
        return `${indent}${mark} ${agent.name}${summary}`;
      })
      .join('\n');
    return new Text(`${header}\n${body}`, 1, 0).render(width);
  }
}

/** Compact-mode overlay for Plan / Agents / Memory (ADR-009 Phase 3–4). */
export class CompactOverlayPanel implements Component {
  constructor(private readonly getState: () => ShellState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.getState();
    if (state.compactOverlay === 'none') return [];
    if (state.compactOverlay === 'plan') {
      return new PlanPanel(this.getState).render(width);
    }
    if (state.compactOverlay === 'agents') {
      return new AgentsPanel(this.getState).render(width);
    }
    return new MemoryPanel(this.getState).render(width);
  }
}

export class MemoryPanel implements Component {
  constructor(private readonly getState: () => ShellState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const snapshot = this.getState().memorySnapshot;
    const header = theme.memory('Memory');
    if (!snapshot || snapshot.trim().length === 0) {
      return new Text(`${header}\n${theme.muted('No recent memory activity')}`, 1, 0).render(width);
    }
    return new Text(`${header}\n${snapshot}`, 1, 0).render(width);
  }
}
