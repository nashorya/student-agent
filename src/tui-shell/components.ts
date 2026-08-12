import type { Component } from '@earendil-works/pi-tui';
import { Text } from '@earendil-works/pi-tui';
import type { ShellState } from './state.js';
import { theme } from './theme.js';
import { isWide } from './layout.js';

function roleStyle(role: ShellState['messages'][number]['role']): (s: string) => string {
  switch (role) {
    case 'user':
      return theme.accent;
    case 'assistant':
      return theme.text;
    case 'tool':
      return theme.tool;
    case 'system':
      return theme.muted;
    case 'error':
      return theme.danger;
    default:
      return theme.text;
  }
}

function roleLabel(role: ShellState['messages'][number]['role']): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'tool':
      return 'Tool';
    case 'system':
      return 'System';
    case 'error':
      return 'Error';
    default:
      return role;
  }
}

/** Phase 1 transcript: simple role-colored Text lines (activity timeline is Phase 2). */
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
      const style = roleStyle(msg.role);
      const header = style(`${roleLabel(msg.role)}:`);
      const body = msg.content.length > 0 ? msg.content : theme.muted('…');
      const block = new Text(`${header} ${body}`, 1, 0);
      lines.push(...block.render(width));
      lines.push('');
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
    }

    const line = theme.muted(parts.join(' · '));
    // Truncate manually — TruncatedText has no setText.
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
    const agents = this.getState().agents;
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
        const summary = agent.summary ? theme.muted(` — ${agent.summary}`) : '';
        return `${mark} ${agent.name}${summary}`;
      })
      .join('\n');
    return new Text(`${header}\n${body}`, 1, 0).render(width);
  }
}
