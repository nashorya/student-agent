export type PhaseSignal =
  | { type: 'task_start'; name: string; phases: string[] }
  | { type: 'phase_done'; phaseIndex: number; summary: string; nextStepHint: string };

const TASK_START_RE = /\[TASK_START name="([^"]+)"\]([\s\S]*?)\[\/TASK_START\]/;
const PHASE_DONE_RE = /\[PHASE_DONE phase=(\d+)\]([\s\S]*?)\[\/PHASE_DONE\]/;
const PHASE_LINE_RE = /^Phase\s+(\d+)\s*[:：]\s*(.*)$/i;
const MAX_PHASES = 5;

export function parsePhaseSignal(text: string): PhaseSignal | null {
  const taskMatch = TASK_START_RE.exec(text);
  if (taskMatch) {
    const phases = parseTaskStartPhases(taskMatch[2]);
    return { type: 'task_start', name: taskMatch[1], phases };
  }

  const doneMatch = PHASE_DONE_RE.exec(text);
  if (doneMatch) {
    const lines = doneMatch[2].trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const summary = lines.find((l) => l.startsWith('已完成')) ?? lines[0] ?? '';
    const nextStepHint = lines.find((l) => l.startsWith('下一步')) ?? '';
    return { type: 'phase_done', phaseIndex: externalPhaseNumberToIndex(Number(doneMatch[1])), summary, nextStepHint };
  }

  return null;
}

function externalPhaseNumberToIndex(phaseNumber: number): number {
  return Math.max(0, phaseNumber - 1);
}

export function stripPhaseSignals(text: string): string {
  return text
    .replace(/\[TASK_START[^\]]*\][\s\S]*?\[\/TASK_START\]/g, '')
    .replace(/\[PHASE_DONE[^\]]*\][\s\S]*?\[\/PHASE_DONE\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseTaskStartPhases(block: string): string[] {
  const phases: string[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const phaseMatch = PHASE_LINE_RE.exec(line);
    if (phaseMatch) {
      if (phases.length >= MAX_PHASES) break;
      const desc = phaseMatch[2].trim();
      if (desc) phases.push(desc);
      continue;
    }

    if (phases.length > 0 && phases.length <= MAX_PHASES) {
      phases[phases.length - 1] = `${phases[phases.length - 1]} ${line}`.trim();
    }
  }

  return phases;
}
