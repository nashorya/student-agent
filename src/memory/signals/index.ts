export { createSignalPipeline, type SignalPipelineOptions } from './signal-pipeline.js';
export { appendSignal, readRecentSignals, getSignalsPath } from './signal-store.js';
export {
  detectLostness,
  type LostnessDetectorInput,
  type LostnessResult,
  type TurnSnapshot,
} from './lostness-detector.js';
export type { Signal, SignalKind, SignalSeverity } from './types.js';
