import path from 'node:path';
import { getCompletions } from './components/completions.js';
import { renderTaskPanelLines } from './components/task-panel.js';
import type { TUIV2Message, TUIV2State } from './state.js';
import { stripAnsi } from './terminal-control.js';

export interface OpenCodeViewOptions {
  cwd: string;
  home?: string;
  model?: string;
  columns?: number;
}

export interface OpenCodeMessageView {
  id: string;
  role: TUIV2Message['role'];
  content: string;
  streaming: boolean;
}

export interface OpenCodeView {
  messages: OpenCodeMessageView[];
  taskPanelLines: string[];
  status: string;
  footer: string;
  promptQuestion: string | null;
  promptQuestionRows: number;
  completions: string[];
  completionRows: number;
}

export function createOpenCodeView(
  state: TUIV2State,
  options: OpenCodeViewOptions,
): OpenCodeView {
  const completions = getCompletions(state.input.value);
  const columns = options.columns ?? 80;
  return {
    messages: state.transcript.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      streaming: message.status === 'streaming',
    })),
    taskPanelLines: renderTaskPanelLines(state.taskPanel, columns).map(stripAnsi),
    status: formatStatus(state),
    footer: [
      abbreviateHome(options.cwd, options.home),
      shortModelName(options.model),
      'ctrl+c abort',
      'ctrl+d exit',
    ].filter(Boolean).join('  ·  '),
    promptQuestion: state.prompt?.question ?? null,
    promptQuestionRows: countBoundedRows(state.prompt?.question, 10),
    completions,
    completionRows: completions.length > 0 ? completions.length + 1 : 0,
  };
}

function countBoundedRows(value: string | undefined, maximum: number): number {
  if (!value) return 0;
  return Math.min(maximum, value.split('\n').length);
}

function formatStatus(state: TUIV2State): string {
  if (state.status.transient) return state.status.transient;

  const task = state.taskPanel;
  if (!task) return state.status.currentTool ? `Running ${state.status.currentTool}` : 'Ready';

  const pieces = [
    task.name,
    task.state && task.state !== 'idle' ? task.state : undefined,
    task.toolCallCount === undefined
      ? undefined
      : `${task.toolCallCount} tool${task.toolCallCount === 1 ? '' : 's'}`,
    task.elapsedMs === undefined ? undefined : formatElapsed(task.elapsedMs),
  ];
  return pieces.filter(Boolean).join('  ·  ') || 'Ready';
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  return `${(elapsedMs / 1000).toFixed(elapsedMs < 10_000 ? 1 : 0)}s`;
}

function abbreviateHome(input: string, home?: string): string {
  if (!home) return input;
  const relative = path.relative(home, input);
  if (relative === '') return '~';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return input;
  }
  return `~${path.sep}${relative}`;
}

function shortModelName(model?: string): string | undefined {
  if (!model) return undefined;
  return model.split('/').filter(Boolean).at(-1);
}
