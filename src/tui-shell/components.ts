import type { Component } from '@earendil-works/pi-tui';
import { Text } from '@earendil-works/pi-tui';
import type { ActivityKind, ShellMessage, ShellState } from './state.js';
import { theme } from './theme.js';
import { sectionRailTitle } from './chrome.js';
import { sortAgentRowsForTree } from './project-workbench.js';

/** Real unified-diff markers only — not markdown bullets (`- item`). */
const DIFF_FILE_RE = /^(?:diff --git |Index: |\+\+\+ |--- )/;
const DIFF_HUNK_RE = /^@@ /;
const DIFF_CHANGE_RE = /^[+-](?![+-])/;

function kindStyle(kind: ActivityKind): (s: string) => string {
  switch (kind) {
    case 'user':
      return theme.accent;
    case 'assistant':
      return theme.title;
    case 'reasoning':
      return theme.faint;
    case 'tool':
      return theme.tool;
    case 'diff':
      return theme.muted;
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

function kindLabel(
  kind: ActivityKind,
  meta: ShellMessage['meta'] | undefined,
  live: boolean,
): string {
  switch (kind) {
    case 'user':
      return 'You';
    case 'assistant':
      return live ? 'Assistant · live' : 'Assistant';
    case 'reasoning':
      return live ? 'reasoning · live' : 'reasoning';
    case 'tool': {
      const status = meta?.toolStatus;
      if (status === 'running') return 'tool · running';
      if (status === 'failed') return 'tool · failed';
      if (status === 'done') return 'tool';
      return 'tool';
    }
    case 'diff':
      return 'diff';
    case 'system':
      return 'meta';
    case 'prompt':
      return 'ask';
    case 'error':
      return 'error';
    case 'recovery':
      return 'recovery';
    case 'verification':
      return 'verify';
    case 'signal':
      return 'signal';
    case 'reflect':
      return 'reflect';
    case 'recall':
      return 'recall';
    default:
      return kind;
  }
}

function looksLikeDiff(content: string): boolean {
  const lines = content.split('\n').slice(0, 80);
  let files = 0;
  let hunks = 0;
  let plus = 0;
  let minus = 0;
  for (const line of lines) {
    if (DIFF_FILE_RE.test(line)) files += 1;
    else if (DIFF_HUNK_RE.test(line)) hunks += 1;
    else if (DIFF_CHANGE_RE.test(line)) {
      if (line.startsWith('+')) plus += 1;
      else minus += 1;
    }
  }
  // Require a file/hunk header, or both + and - change lines (not markdown lists).
  if (files >= 1 || hunks >= 1) return true;
  return plus >= 2 && minus >= 2;
}

function renderDiffBody(content: string, width: number): string[] {
  const lines: string[] = [];
  for (const raw of content.split('\n')) {
    let painted = raw;
    if (raw.startsWith('+') && !raw.startsWith('+++')) painted = theme.diffAdded(raw);
    else if (raw.startsWith('-') && !raw.startsWith('---')) painted = theme.diffRemoved(raw);
    else if (raw.startsWith('@@')) painted = theme.muted(raw);
    else painted = theme.faint(raw);
    lines.push(...new Text(painted, 1, 0).render(width));
  }
  return lines;
}

function indentBody(content: string, paint: (s: string) => string, width: number): string[] {
  const indented = content
    .split('\n')
    .map((line) => paint(`  ${line}`))
    .join('\n');
  return new Text(indented, 1, 0).render(width);
}

function renderActivity(
  msg: ShellMessage,
  width: number,
  streaming: { assistantId: string | null; reasoningId: string | null },
): string[] {
  const live =
    (msg.kind === 'assistant' && msg.id === streaming.assistantId)
    || (msg.kind === 'reasoning' && msg.id === streaming.reasoningId);
  const style = kindStyle(msg.kind);
  const label = style(kindLabel(msg.kind, msg.meta, live));
  const body = msg.content.length > 0 ? msg.content : theme.faint('…');

  if (msg.kind === 'reasoning') {
    return [label, ...indentBody(body, theme.reasoning, width)];
  }

  if (msg.kind === 'tool') {
    return [theme.muted(`${label}  `) + theme.tool(body)];
  }

  if (msg.kind === 'diff' || (msg.kind === 'assistant' && looksLikeDiff(msg.content))) {
    return [label, ...renderDiffBody(msg.content, width)];
  }

  if (msg.kind === 'user') {
    return [label, ...indentBody(body, theme.text, width)];
  }

  if (msg.kind === 'assistant') {
    return [label, ...indentBody(body, theme.text, width)];
  }

  if (msg.kind === 'system') {
    // Readable meta — never dim.gray body on black.
    return new Text(theme.muted(`· ${msg.content}`), 1, 0).render(width);
  }

  return [label, ...indentBody(body, style, width)];
}

/** Main activity timeline — hierarchical, not a flat log dump. */
export class TranscriptView implements Component {
  constructor(private readonly getState: () => ShellState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.getState();
    const { messages } = state;
    const streaming = {
      assistantId: state.streamingAssistantId,
      reasoningId: state.streamingReasoningId,
    };

    if (messages.length === 0) {
      return new Text(
        theme.faint('Transcript\n  Waiting for a prompt in Compose below.'),
        1,
        0,
      ).render(width);
    }

    const lines: string[] = [];
    for (const msg of messages) {
      lines.push(...renderActivity(msg, width, streaming));
      if (msg.kind !== 'tool' && msg.kind !== 'system') {
        lines.push('');
      }
    }
    return lines;
  }
}

export class PlanPanel implements Component {
  constructor(private readonly getState: () => ShellState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const steps = this.getState().planSteps;
    const title = sectionRailTitle('Plan', width);
    if (steps.length === 0) {
      return [title, theme.faint('  No plan yet')];
    }
    const body = steps.map((step) => {
      const mark =
        step.status === 'done' ? theme.success('✓') :
        step.status === 'active' ? theme.accent('●') :
        theme.faint('○');
      return `  ${mark} ${theme.text(step.title)}`;
    });
    return [title, ...body];
  }
}

export class AgentsPanel implements Component {
  constructor(private readonly getState: () => ShellState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const agents = sortAgentRowsForTree(this.getState().agents);
    const title = sectionRailTitle('Subagents', width);
    if (agents.length === 0) {
      return [title, theme.faint('  No subagents')];
    }
    const body = agents.map((agent) => {
      const mark =
        agent.status === 'done' ? theme.success('✓') :
        agent.status === 'failed' ? theme.danger('✗') :
        theme.accent('●');
      const indent = agent.parentId ? theme.faint('  └ ') : '  ';
      const summary = agent.summary ? theme.faint(` — ${agent.summary}`) : '';
      return `${indent}${mark} ${theme.text(agent.name)}${summary}`;
    });
    return [title, ...body];
  }
}

/** Compact-mode overlay for Plan / Agents / Memory. */
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
    const title = sectionRailTitle('Memory', width);
    if (!snapshot || snapshot.trim().length === 0) {
      return [title, theme.faint('  No recent memory activity')];
    }
    const body = snapshot.split('\n').map((line) => theme.muted(`  ${line}`));
    return [title, ...body];
  }
}

/** Divider between Plan and Subagents inside the right rail. */
export class SidebarSectionGap implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    return ['', theme.border('├' + '─'.repeat(Math.max(1, width - 1))), ''];
  }
}
