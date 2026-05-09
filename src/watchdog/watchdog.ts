import type { BenchmarkResult } from './benchmark-runner.js';
import type { QualityFeedbackEntry } from './feedback-collector.js';
import type { DesignCritique } from '../memory/design/types.js';

export interface WatchdogSignals {
  feedback: QualityFeedbackEntry[];
  benchmarkResults: BenchmarkResult[];
  unverifiedCandidateRatio: number;
  designCritiques?: DesignCritique[];
  unverifiedDesignCandidateRatio?: number;
}

export interface WatchdogEvaluation {
  degradedSignals: string[];
  shouldAlert: boolean;
  report: string | null;
}

const NEGATIVE_FEEDBACK_THRESHOLD = 0.4;
const BENCHMARK_SCORE_THRESHOLD = 0.7;
const UNVERIFIED_RATIO_THRESHOLD = 0.5;
const DESIGN_SCORE_THRESHOLD = 0.75;

export class QualityWatchdog {
  evaluate(signals: WatchdogSignals): WatchdogEvaluation {
    const degradedSignals: string[] = [];

    const feedbackRate = negativeFeedbackRate(signals.feedback.slice(-10));
    if (feedbackRate !== null && feedbackRate >= NEGATIVE_FEEDBACK_THRESHOLD) {
      degradedSignals.push(`用户负反馈率 ${Math.round(feedbackRate * 100)}%`);
    }

    const benchmarkScore = averageBenchmarkScore(signals.benchmarkResults.slice(-6));
    if (benchmarkScore !== null && benchmarkScore < BENCHMARK_SCORE_THRESHOLD) {
      degradedSignals.push(`基准任务平均分 ${benchmarkScore.toFixed(2)}`);
    }

    if (signals.unverifiedCandidateRatio >= UNVERIFIED_RATIO_THRESHOLD) {
      degradedSignals.push(`未验证候选比例 ${Math.round(signals.unverifiedCandidateRatio * 100)}%`);
    }

    const designScore = averageDesignScore((signals.designCritiques ?? []).slice(-5));
    if (designScore !== null && designScore < DESIGN_SCORE_THRESHOLD) {
      degradedSignals.push(`视觉一致性平均分 ${designScore.toFixed(2)}`);
    }

    const designRatio = signals.unverifiedDesignCandidateRatio ?? 0;
    if (designRatio >= UNVERIFIED_RATIO_THRESHOLD) {
      degradedSignals.push(`未验证设计候选比例 ${Math.round(designRatio * 100)}%`);
    }

    const shouldAlert = degradedSignals.length >= 2;
    return {
      degradedSignals,
      shouldAlert,
      report: shouldAlert ? renderAlert(degradedSignals) : null,
    };
  }
}

function averageDesignScore(critiques: DesignCritique[]): number | null {
  if (critiques.length === 0) {
    return null;
  }
  return critiques.reduce((total, critique) => total + critique.score, 0) / critiques.length;
}

function negativeFeedbackRate(feedback: QualityFeedbackEntry[]): number | null {
  if (feedback.length < 3) {
    return null;
  }
  const negative = feedback.filter((entry) => entry.rating === 'down').length;
  return negative / feedback.length;
}

function averageBenchmarkScore(results: BenchmarkResult[]): number | null {
  if (results.length === 0) {
    return null;
  }
  const sum = results.reduce((total, result) => total + result.score, 0);
  return sum / results.length;
}

function renderAlert(degradedSignals: string[]): string {
  return [
    '[QualityWatchdog] 检测到多个质量信号退化：',
    ...degradedSignals.map((signal) => `- ${signal}`),
    '已记录报告；不会自动修改系统行为。',
  ].join('\n');
}
