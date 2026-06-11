import type {
  EvalContextAssemblyTrace,
  EvalContextLayer,
  EvalContextLayerSummary,
  EvalContextTokenEffect,
  EvalPiSchemaTrace,
  EvalTokenUsageEvent,
} from './types.js';

const TOKEN_CHAR_RATIO = 3.5;
const LAYERS: EvalContextLayer[] = ['L0', 'L1', 'L2', 'L3'];

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_RATIO);
}

export function summarizeContextTraceLayers(
  trace: Pick<EvalContextAssemblyTrace, 'sections'>,
): Record<EvalContextLayer, EvalContextLayerSummary> {
  const result = emptyLayerSummaries();
  for (const section of trace.sections) {
    const summary = result[section.layer];
    summary.chars += section.chars;
    summary.estimatedTokens += section.estimatedTokens;
    summary.sectionCount += 1;
    summary.sectionIds.push(section.id);
  }
  return result;
}

export function buildContextTokenEffect(options: {
  contextAssemblyTraces?: EvalContextAssemblyTrace[];
  usageEvents?: EvalTokenUsageEvent[];
  piSchemaTrace?: EvalPiSchemaTrace;
  instruction?: string;
}): EvalContextTokenEffect {
  const usageEvents = options.usageEvents ?? [];
  const observedInputTokens = usageEvents.reduce((sum, event) => sum + event.usage.inputTokens, 0);
  const observedTotalTokens = usageEvents.reduce((sum, event) => sum + event.usage.totalTokens, 0);
  const llmRequestCount = usageEvents.length;
  const latestTrace = options.contextAssemblyTraces?.at(-1);
  const promptLayers = latestTrace?.layers ?? emptyLayerSummaries();
  const repeatedLayers = emptyLayerSummaries();
  const multiplier = Math.max(1, llmRequestCount);

  for (const layer of LAYERS) {
    repeatedLayers[layer] = {
      ...promptLayers[layer],
      chars: promptLayers[layer].chars * multiplier,
      estimatedTokens: promptLayers[layer].estimatedTokens * multiplier,
    };
  }

  const toolSchemaEstimatedTokens = estimateToolSchemaTokens(
    options.piSchemaTrace,
    llmRequestCount,
  );
  const instructionEstimatedTokens = options.instruction ? estimateTextTokens(options.instruction) : 0;
  repeatedLayers.L0.estimatedTokens += toolSchemaEstimatedTokens + instructionEstimatedTokens;
  repeatedLayers.L0.sectionIds = [
    ...repeatedLayers.L0.sectionIds,
    ...(toolSchemaEstimatedTokens > 0 ? ['piToolSchemas'] : []),
    ...(instructionEstimatedTokens > 0 ? ['taskInstruction'] : []),
  ];
  repeatedLayers.L0.sectionCount = repeatedLayers.L0.sectionIds.length;

  const contextPromptEstimatedTokens = latestTrace?.renderedPromptEstimatedTokens ?? 0;
  const repeatedContextPromptEstimatedTokens = contextPromptEstimatedTokens * multiplier;
  const classifiedInputTokens = LAYERS.reduce(
    (sum, layer) => sum + repeatedLayers[layer].estimatedTokens,
    0,
  );
  const unclassifiedInputTokens = Math.max(0, observedInputTokens - classifiedInputTokens);

  return {
    observedInputTokens,
    observedTotalTokens,
    llmRequestCount,
    contextPromptEstimatedTokens,
    repeatedContextPromptEstimatedTokens,
    toolSchemaEstimatedTokens,
    instructionEstimatedTokens,
    layers: repeatedLayers,
    classifiedInputTokens,
    unclassifiedInputTokens,
    estimatedClassifiedShareOfObservedInput: roundRatio(
      observedInputTokens === 0 ? 0 : classifiedInputTokens / observedInputTokens,
    ),
    note: 'Layer token counts are estimated from recorded prompt text using chars/3.5; observed input tokens come from provider usage. L0 also includes estimated tool schema injections and the initial task instruction.',
  };
}

function emptyLayerSummaries(): Record<EvalContextLayer, EvalContextLayerSummary> {
  return {
    L0: emptyLayer('L0'),
    L1: emptyLayer('L1'),
    L2: emptyLayer('L2'),
    L3: emptyLayer('L3'),
  };
}

function estimateToolSchemaTokens(
  trace: EvalPiSchemaTrace | undefined,
  llmRequestCount: number,
): number {
  if (!trace) return 0;
  if (trace.estimatedTotalSchemaTokens > 0) return trace.estimatedTotalSchemaTokens;
  if (trace.approxSchemaTokens <= 0) return 0;
  const injectionCount = trace.estimatedSchemaInjectionCount > 0
    ? trace.estimatedSchemaInjectionCount
    : llmRequestCount;
  return trace.approxSchemaTokens * injectionCount;
}

function emptyLayer(layer: EvalContextLayer): EvalContextLayerSummary {
  return {
    layer,
    chars: 0,
    estimatedTokens: 0,
    sectionCount: 0,
    sectionIds: [],
  };
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6));
}
