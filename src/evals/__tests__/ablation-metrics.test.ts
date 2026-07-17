import { describe, expect, it } from 'vitest';
import type { RunEvent, TaskOutcome } from '../../memory/run-archive/index.js';
import {
  aggregateAblationMetrics,
  compareAblationConfigs,
  extractAblationRunMetrics,
} from '../ablation-metrics.js';

describe('ablation metrics', () => {
  it('extracts metrics from outcome and protected events', () => {
    const metrics = extractAblationRunMetrics({
      outcome: outcome(),
      events: [
        event('toolguard_block'),
        event('hashline_rejection'),
        event('lostness_soft'),
      ],
      verifierPassed: true,
      estimatedPromptTokens: 1200,
      outputTokens: 600,
      runDurationMs: 1500,
    });

    expect(metrics).toMatchObject({
      task_success_rate: 1,
      verified_pass_rate: 1,
      tool_error_count: 2,
      unsafe_tool_block_count: 1,
      hashline_rejection_count: 1,
      hashline_recovery_count: 1,
      lostness_trigger_count: 1,
      user_correction_count: 1,
      estimated_prompt_tokens: 1200,
      output_tokens: 600,
      repeated_tool_call_count: 1,
      run_duration_ms: 1500,
      trace_event_count: 3,
    });
  });

  it('extracts recall utilization and verified citation metrics', () => {
    const metrics = extractAblationRunMetrics({
      outcome: outcome({
        recallAudit: {
          injected_recall_ids: ['k1', 'k2'],
          cited_recall_ids: ['k1', 'unknown'],
          used_recall_ids: ['k1'],
          invalid_recall_ids: ['unknown'],
          citation_events: [],
          utilization_rate: 0.5,
        },
      }),
      events: [],
      verifierPassed: true,
    });

    expect(metrics).toMatchObject({
      recall_injection_rate: 1,
      recall_utilization_rate: 0.5,
      invalid_recall_citation_rate: 0.5,
      cited_and_verified_rate: 1,
    });
  });

  it('aggregates configs and computes interaction loss', () => {
    const configs = [
      aggregateAblationMetrics('baseline', [metric(0.4)]),
      aggregateAblationMetrics('toolguard_only', [metric(0.6)]),
      aggregateAblationMetrics('contextbuilder_only', [metric(0.5)]),
      aggregateAblationMetrics('signal_pipeline_only', [metric(0.4)]),
      aggregateAblationMetrics('hashline_only', [metric(0.7)]),
      aggregateAblationMetrics('all_components', [metric(0.8)]),
    ];

    const comparison = compareAblationConfigs(configs);

    expect(comparison.bestSingleComponent).toBe('hashline_only');
    expect(comparison.deltaVsBaseline.all_components).toBe(0.4);
    expect(comparison.deltaVsBestSingleComponent.all_components).toBe(0.1);
    expect(comparison.interactionLoss).toBe(0.2);
  });
});

function outcome(overrides: Partial<TaskOutcome> = {}): TaskOutcome {
  return {
    taskId: 'task_1',
    runId: 'run_1',
    status: 'success',
    userCorrectionCount: 1,
    toolErrorCount: 2,
    hashlineRejectionCount: 1,
    hashlineRecoveryCount: 1,
    repeatedToolCallCount: 1,
    lostnessTriggerCount: 1,
    finalSummary: 'done',
    evidenceRefs: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function event(kind: RunEvent['kind']): RunEvent {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    kind,
    summary: kind,
  };
}

function metric(taskSuccessRate: number) {
  return {
    task_success_rate: taskSuccessRate,
    verified_pass_rate: taskSuccessRate,
    tool_error_count: 0,
    unsafe_tool_block_count: 0,
    hashline_rejection_count: 0,
    hashline_recovery_count: 0,
    lostness_trigger_count: 0,
    user_correction_count: 0,
    estimated_prompt_tokens: 0,
    output_tokens: 0,
    repeated_tool_call_count: 0,
    run_duration_ms: 0,
    trace_event_count: 0,
    recall_injection_rate: 0,
    recall_utilization_rate: 0,
    invalid_recall_citation_rate: 0,
    cited_and_verified_rate: 0,
  };
}
