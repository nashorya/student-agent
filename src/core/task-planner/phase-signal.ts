export type PhaseSignal =
  | { type: 'task_start'; name: string; phases: string[] }
  | { type: 'phase_done'; phaseIndex: number; summary: string; nextStepHint: string };

const TASK_START_RE = /\[TASK_START name="([^"]+)"\]([\s\S]*?)\[\/TASK_START\]/;
const PHASE_DONE_RE = /\[PHASE_DONE phase=(\d+)\]([\s\S]*?)\[\/PHASE_DONE\]/;

export function parsePhaseSignal(text: string): PhaseSignal | null {
  const taskMatch = TASK_START_RE.exec(text);
  if (taskMatch) {
    const phases = taskMatch[2]
      .split('\n')
      .map((l) => l.replace(/^Phase \d+:\s*/, '').trim())
      .filter(Boolean);
    return { type: 'task_start', name: taskMatch[1], phases };
  }

  const doneMatch = PHASE_DONE_RE.exec(text);
  if (doneMatch) {
    const lines = doneMatch[2].trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const summary = lines.find((l) => l.startsWith('已完成')) ?? lines[0] ?? '';
    const nextStepHint = lines.find((l) => l.startsWith('下一步')) ?? '';
    return { type: 'phase_done', phaseIndex: Number(doneMatch[1]), summary, nextStepHint };
  }

  return null;
}

export function stripPhaseSignals(text: string): string {
  return text
    .replace(/\[TASK_START[^\]]*\][\s\S]*?\[\/TASK_START\]/g, '')
    .replace(/\[PHASE_DONE[^\]]*\][\s\S]*?\[\/PHASE_DONE\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
