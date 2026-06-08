import type { TaskWorkingMemory } from '../tasks/types.js';
import type { Signal } from './types.js';

export interface LostnessDetectorInput {
  workingMemory: TaskWorkingMemory;
  recentSignals: Signal[];
  turnSnapshots: TurnSnapshot[];
}

export interface TurnSnapshot {
  turnIndex: number;
  completedTodos: number;
  writeFileCount: number;
  phase: string;
  hasUserAdvance: boolean;
}

export type LostnessResult = {
  triggered: boolean;
  severity: 'hard' | 'soft' | 'none';
  reasons: string[];
  signal?: Omit<Signal, 'id' | 'createdAt'>;
};

const RECENT_SIGNAL_WINDOW = 5;
const STAGNATION_WINDOW = 5;

export function detectLostness(input: LostnessDetectorInput): LostnessResult {
  const hardReasons = [
    repeatedSimilarUserCorrection(input.recentSignals),
    repeatedSamePatternToolErrors(input.recentSignals),
  ].filter(isPresent);

  if (hardReasons.length > 0) {
    return result('hard', hardReasons);
  }

  const softReasons = [
    toolThrashing(input.recentSignals),
    stagnation(input.turnSnapshots),
    answerBloat(),
  ].filter(isPresent);

  if (softReasons.length >= 2) {
    return result('soft', softReasons);
  }

  return {
    triggered: false,
    severity: 'none',
    reasons: [],
  };
}

function repeatedSimilarUserCorrection(signals: Signal[]): string | null {
  const corrections = signals.filter((signal) => signal.kind === 'user_correction');
  for (let i = 0; i < corrections.length; i++) {
    for (let j = i + 1; j < corrections.length; j++) {
      if (
        corrections[i].path && corrections[i].path === corrections[j].path
        || corrections[i].toolName && corrections[i].toolName === corrections[j].toolName
      ) {
        return 'repeated_user_correction_same_context';
      }
    }
  }
  return null;
}

function repeatedSamePatternToolErrors(signals: Signal[]): string | null {
  let previousPattern: string | undefined;
  let streak = 0;

  for (const signal of signals) {
    if (signal.kind !== 'tool_error' || !signal.pattern) {
      previousPattern = undefined;
      streak = 0;
      continue;
    }
    if (signal.pattern === previousPattern) {
      streak++;
    } else {
      previousPattern = signal.pattern;
      streak = 1;
    }
    if (streak >= 3) return `tool_error_same_pattern_streak:${signal.pattern}`;
  }

  return null;
}

function toolThrashing(signals: Signal[]): string | null {
  const counts = new Map<string, number>();
  for (const signal of signals.slice(-RECENT_SIGNAL_WINDOW)) {
    if (signal.kind !== 'tool_error' || !signal.toolName) continue;
    counts.set(signal.toolName, (counts.get(signal.toolName) ?? 0) + 1);
  }

  for (const [toolName, count] of counts) {
    if (count >= 3) return `tool_thrashing:${toolName}`;
  }
  return null;
}

function stagnation(snapshots: TurnSnapshot[]): string | null {
  const recent = snapshots.slice(-STAGNATION_WINDOW);
  if (recent.length < STAGNATION_WINDOW) return null;

  const first = recent[0];
  const completedTodosUnchanged = recent.every((snapshot) => (
    snapshot.completedTodos === first.completedTodos
  ));
  const writeFileCountUnchanged = recent.every((snapshot) => (
    snapshot.writeFileCount === first.writeFileCount
  ));
  const phaseUnchanged = recent.every((snapshot) => snapshot.phase === first.phase);
  const noUserAdvance = recent.every((snapshot) => !snapshot.hasUserAdvance);

  return completedTodosUnchanged && writeFileCountUnchanged && phaseUnchanged && noUserAdvance
    ? 'stagnation:no_progress_5_turns'
    : null;
}

function answerBloat(): string | null {
  return null;
}

function result(severity: 'hard' | 'soft', reasons: string[]): LostnessResult {
  return {
    triggered: true,
    severity,
    reasons,
    signal: {
      kind: severity === 'hard' ? 'lostness_hard' : 'lostness_soft',
      severity: severity === 'hard' ? 'high' : 'medium',
      summary: `Lostness ${severity}: ${reasons.join(', ')}`,
    },
  };
}

function isPresent(value: string | null): value is string {
  return value !== null;
}
