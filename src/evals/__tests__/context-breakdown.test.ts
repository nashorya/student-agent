import { describe, expect, it } from 'vitest';
import {
  buildContextTokenEffect,
  estimateTextTokens,
  summarizeContextTraceLayers,
} from '../context-breakdown.js';
import type { EvalContextAssemblyTrace, EvalPiSchemaTrace, EvalTokenUsageEvent } from '../types.js';

describe('context breakdown helpers', () => {
  it('summarizes L0-L3 trace sections', () => {
    const trace = contextTrace([
      ['L0', 'hardcoded', 'fixed rules'],
      ['L1', 'taskSpec', 'goal step'],
      ['L2', 'workingMemory', 'todo one'],
      ['L3', 'knacks', 'use rg'],
      ['L3', 'preferences', 'short answer'],
    ]);

    const layers = summarizeContextTraceLayers(trace);

    expect(layers.L0.sectionCount).toBe(1);
    expect(layers.L1.sectionIds).toEqual(['taskSpec']);
    expect(layers.L2.estimatedTokens).toBe(estimateTextTokens('todo one'));
    expect(layers.L3.sectionCount).toBe(2);
  });

  it('estimates repeated L0-L3 contribution against observed provider input', () => {
    const trace = contextTrace([
      ['L0', 'hardcoded', 'fixed system prompt'],
      ['L1', 'taskSpec', 'goal and current step'],
      ['L2', 'workingMemory', 'open todo'],
      ['L3', 'knacks', 'historical recall'],
    ]);
    const usageEvents: EvalTokenUsageEvent[] = [
      { index: 1, usage: usage(1000) },
      { index: 2, usage: usage(800) },
    ];
    const piSchemaTrace: EvalPiSchemaTrace = {
      toolCount: 2,
      toolNames: ['read', 'edit'],
      schemaChars: 700,
      approxSchemaTokens: 200,
      llmRequestCount: 2,
      estimatedSchemaInjectionCount: 2,
      estimatedTotalSchemaTokens: 400,
      perTool: [],
      note: 'test',
    };

    const effect = buildContextTokenEffect({
      contextAssemblyTraces: [trace],
      usageEvents,
      piSchemaTrace,
      instruction: 'Fix the bug.',
    });

    expect(effect.observedInputTokens).toBe(1800);
    expect(effect.llmRequestCount).toBe(2);
    expect(effect.layers.L0.estimatedTokens).toBe(
      trace.layers.L0.estimatedTokens * 2
      + piSchemaTrace.estimatedTotalSchemaTokens
      + estimateTextTokens('Fix the bug.'),
    );
    expect(effect.layers.L1.estimatedTokens).toBe(trace.layers.L1.estimatedTokens * 2);
    expect(effect.layers.L2.estimatedTokens).toBe(trace.layers.L2.estimatedTokens * 2);
    expect(effect.layers.L3.estimatedTokens).toBe(trace.layers.L3.estimatedTokens * 2);
    expect(effect.unclassifiedInputTokens).toBeGreaterThan(0);
    expect(effect.note).toContain('estimated');
  });
});

function contextTrace(
  sections: Array<['L0' | 'L1' | 'L2' | 'L3', string, string]>,
): EvalContextAssemblyTrace {
  const traceSections = sections.map(([layer, id, content]) => ({
    layer,
    id,
    title: id,
    chars: content.length,
    estimatedTokens: estimateTextTokens(content),
  }));
  return {
    pipeline: 'new',
    generatedAt: '2026-06-11T00:00:00.000Z',
    runMode: 'eval',
    piSchemaRenderMode: 'summary',
    tier: 'standard',
    tierReason: 'default_standard',
    truncated: [],
    renderedPromptChars: 100,
    renderedPromptEstimatedTokens: 29,
    sections: traceSections,
    layers: summarizeContextTraceLayers({ sections: traceSections } as EvalContextAssemblyTrace),
  };
}

function usage(inputTokens: number) {
  return {
    inputTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: inputTokens,
    costUsd: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}
