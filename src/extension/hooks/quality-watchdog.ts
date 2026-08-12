import { BenchmarkResultsManager } from '../../watchdog/benchmark-runner.js';
import { QualityFeedbackManager, shouldRequestFeedback } from '../../watchdog/feedback-collector.js';
import { QualityWatchdog } from '../../watchdog/watchdog.js';
import { PreferenceCandidatesManager } from '../../memory/candidates/manager.js';
import type { SessionEndContext } from '../../core/pi-bridge/types.js';
import { logger } from '../../runtime/logger.js';

let taskCount = 0;

export function createQualityWatchdogHook(memoryDir: string) {
  const feedbackManager = QualityFeedbackManager.getInstance(memoryDir);
  const benchmarkResultsManager = BenchmarkResultsManager.getInstance(memoryDir);
  const candidatesManager = PreferenceCandidatesManager.getInstance(memoryDir);
  const watchdog = new QualityWatchdog();

  return async (_ctx: SessionEndContext): Promise<void> => {
    taskCount++;
    const feedbackHint = shouldRequestFeedback(taskCount)
      ? ' [👍 /review up] [✅ /review ok] [👎 /review down]'
      : '';
    if (feedbackHint) console.log(`[QualityWatchdog]${feedbackHint}`);

    const [feedback, benchmarkResults, candidates] = await Promise.all([
      feedbackManager.getAll(),
      benchmarkResultsManager.getAll(),
      candidatesManager.getAll(),
    ]);

    const unverified = candidates.filter((candidate) => {
      const latest = candidate.provenance[candidate.provenance.length - 1];
      return latest?.trust_status === 'unverified';
    }).length;
    const unverifiedCandidateRatio = candidates.length === 0 ? 0 : unverified / candidates.length;

    const evaluation = watchdog.evaluate({
      feedback,
      benchmarkResults,
      unverifiedCandidateRatio,
    });

    if (evaluation.report) {
      logger.warn(evaluation.report);
    }
  };
}

export function _resetForTesting(): void {
  taskCount = 0;
}
