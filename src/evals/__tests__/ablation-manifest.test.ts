import { describe, expect, it } from 'vitest';
import { ABLATION_CONFIGS } from '../ablation-config.js';
import { loadAblationManifest, validateAblationManifest } from '../ablation-manifest.js';

describe('ablation manifest', () => {
  it('loads the checked-in ablation benchmark manifest', async () => {
    const manifest = await loadAblationManifest();

    expect(manifest.id).toBe('student-agent-v04-component-ablation');
    expect(manifest.configs).toEqual([
      'baseline',
      'toolguard_only',
      'contextbuilder_only',
      'signal_pipeline_only',
      'hashline_only',
      'all_components',
    ]);
    expect(manifest.configs.every((config) => config in ABLATION_CONFIGS)).toBe(true);
    expect(manifest.tasks.map((task) => task.id)).toEqual([
      'precise-edit',
      'multi-file-patch',
      'search-before-read',
      'preference-aware-edit',
      'failure-recovery-edit-mismatch',
    ]);
    expect(manifest.tasks.every((task) => task.regressionRisks.length > 0)).toBe(true);
  });

  it('rejects unknown config names', () => {
    expect(() => validateAblationManifest({
      schemaVersion: 1,
      id: 'bad',
      version: 'v0.3D',
      description: 'bad',
      configs: ['missing' as never],
      metrics: [{ name: 'task_success_rate', source: 'run_archive', required: true }],
      tasks: [{
        id: 'task',
        family: 'edit',
        expectedRelevantComponent: 'hashline',
        requiredVerifier: 'tests/test.sh',
        requiredTraceMetrics: ['task_success_rate'],
        regressionRisks: ['risk'],
      }],
    })).toThrow('Unknown ablation config');
  });
});
