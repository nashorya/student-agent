export interface AblationConfig {
  toolGuard: boolean;
  contextBuilder: boolean;
  signalPipeline: boolean;
  hashline: boolean;
}

export type AblationConfigName =
  | 'baseline'
  | 'toolguard_only'
  | 'contextbuilder_only'
  | 'signal_pipeline_only'
  | 'hashline_only'
  | 'all_components';

export const ABLATION_CONFIGS: Record<AblationConfigName, AblationConfig> = {
  baseline: {
    toolGuard: false,
    contextBuilder: false,
    signalPipeline: false,
    hashline: false,
  },
  toolguard_only: {
    toolGuard: true,
    contextBuilder: false,
    signalPipeline: false,
    hashline: false,
  },
  contextbuilder_only: {
    toolGuard: false,
    contextBuilder: true,
    signalPipeline: false,
    hashline: false,
  },
  signal_pipeline_only: {
    toolGuard: false,
    contextBuilder: false,
    signalPipeline: true,
    hashline: false,
  },
  hashline_only: {
    toolGuard: false,
    contextBuilder: false,
    signalPipeline: false,
    hashline: true,
  },
  all_components: {
    toolGuard: true,
    contextBuilder: true,
    signalPipeline: true,
    hashline: true,
  },
};

export function getAblationConfig(name: AblationConfigName): AblationConfig {
  return ABLATION_CONFIGS[name];
}
