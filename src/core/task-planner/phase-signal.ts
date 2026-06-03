export type PhaseSignal =
  | { type: 'task_start'; name: string; phases: string[]; context?: TaskPlanningContext }
  | { type: 'phase_done'; phaseIndex: number; summary: string; nextStepHint: string };

export interface TaskPlanningContext {
  goal: string;
  acceptance_criteria: string[];
  constraints: string[];
  open_questions: string[];
  requires_user_acceptance: boolean;
  requires_visual_review: boolean;
}

const TASK_CONTEXT_RE = /\[TASK_CONTEXT\]([\s\S]*?)\[\/TASK_CONTEXT\]/;
const TASK_START_RE = /\[TASK_START name="([^"]+)"\]([\s\S]*?)\[\/TASK_START\]/;
const PHASE_DONE_RE = /\[PHASE_DONE phase=(\d+)\]([\s\S]*?)(?:\[\/PHASE_DONE\]|$)/;
const PHASE_LINE_RE = /^Phase\s+(\d+)(?:\s*[（(][^）)]*[）)])?\s*[:：]\s*(.*)$/iu;
const CONTROL_MARKER_RE = /\[\/?(?:TASK_CONTEXT|TASK_START|PHASE_DONE)\b/i;
const MAX_PHASES = 5;
const MIN_PHASES = 2;

export function parsePhaseSignal(text: string): PhaseSignal | null {
  const contextMatch = TASK_CONTEXT_RE.exec(text);
  const taskMatch = TASK_START_RE.exec(text);
  const doneMatch = PHASE_DONE_RE.exec(text);

  if (doneMatch && (!taskMatch || doneMatch.index > taskMatch.index + taskMatch[0].length)) {
    return buildPhaseDoneSignal(doneMatch);
  }

  if (taskMatch) {
    const phases = parseTaskStartPhases(taskMatch[2]);
    const context = contextMatch ? parseTaskContext(contextMatch[1]) : undefined;
    return context
      ? { type: 'task_start', name: taskMatch[1], phases, context }
      : { type: 'task_start', name: taskMatch[1], phases };
  }

  if (doneMatch) {
    return buildPhaseDoneSignal(doneMatch);
  }

  return null;
}

function buildPhaseDoneSignal(doneMatch: RegExpExecArray): Extract<PhaseSignal, { type: 'phase_done' }> {
  const lines = doneMatch[2].trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const summary = lines.find((l) => l.startsWith('已完成')) ?? lines[0] ?? '';
  const nextStepHint = lines.find((l) => l.startsWith('下一步')) ?? '';
  return { type: 'phase_done', phaseIndex: externalPhaseNumberToIndex(Number(doneMatch[1])), summary, nextStepHint };
}

function externalPhaseNumberToIndex(phaseNumber: number): number {
  return Math.max(0, phaseNumber - 1);
}

export function stripPhaseSignals(text: string): string {
  let visible = text
    .replace(/\[TASK_START[^\]]*\][\s\S]*?\[\/TASK_START\]/g, '')
    .replace(/\[PHASE_DONE[^\]]*\][\s\S]*?\[\/PHASE_DONE\]/g, '')
    .replace(/\[TASK_CONTEXT\][\s\S]*?\[\/TASK_CONTEXT\]/g, '')
    .replace(/\[TASK_START[^\]]*\][\s\S]*$/g, '')
    .replace(/\[PHASE_DONE[^\]]*\][\s\S]*$/g, '')
    .replace(/\[TASK_CONTEXT\][\s\S]*$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (/^\s*Phase\s+\d+(?:\s*[（(][^）)]*[）)])?\s*[:：]/imu.test(visible)) {
    visible = visible.replace(/(?:^|\n)\s*Phase\s+\d+(?:\s*[（(][^）)]*[）)])?\s*[:：][\s\S]*$/iu, '').trim();
  }

  return visible;
}

function parseTaskStartPhases(block: string): string[] {
  const phases: string[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const phaseMatch = PHASE_LINE_RE.exec(line);
    if (phaseMatch) {
      if (phases.length >= MAX_PHASES) break;
      const desc = normalizePhaseDescription(phaseMatch[2]);
      if (desc) phases.push(desc);
      continue;
    }

    if (phases.length > 0 && phases.length <= MAX_PHASES) {
      const desc = normalizePhaseDescription(`${phases[phases.length - 1]} ${line}`);
      if (desc) {
        phases[phases.length - 1] = desc;
      }
    }
  }

  if (!isValidPhaseList(phases)) {
    return [];
  }

  return phases;
}

function normalizePhaseDescription(value: string): string {
  const desc = value
    .replace(/^[*\s-]+/, '')
    .replace(/[*\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!desc || CONTROL_MARKER_RE.test(desc)) {
    return '';
  }
  return desc;
}

function isValidPhaseList(phases: string[]): boolean {
  if (phases.length < MIN_PHASES || phases.length > MAX_PHASES) {
    return false;
  }
  const normalized = phases.map((phase) => phase.toLowerCase());
  return new Set(normalized).size === normalized.length;
}

function parseTaskContext(block: string): TaskPlanningContext {
  const values = new Map<string, string>();
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-zA-Z_]+)\s*[:：]\s*(.*)$/.exec(line);
    if (!match) continue;
    values.set(match[1].toLowerCase(), match[2].trim());
  }

  return {
    goal: values.get('goal') ?? '',
    acceptance_criteria: splitList(values.get('acceptance_criteria')),
    constraints: splitList(values.get('constraints')),
    open_questions: splitList(values.get('open_questions')),
    requires_user_acceptance: parseBoolean(values.get('requires_user_acceptance')),
    requires_visual_review: parseBoolean(values.get('requires_visual_review')),
  };
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s*(?:[|;；,，])\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return /^(true|yes|y|1|是|需要)$/i.test(value.trim());
}
