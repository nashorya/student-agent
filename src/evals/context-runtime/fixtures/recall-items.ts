import type {
  MemoryRecallResult,
  RecallBundle,
  RecallScore,
  RecallableMemoryItem,
  RecalledItem,
} from '../../../memory/recall/types.js';
import { FIXED_NOW } from './working-memory.js';

export function recallItem(overrides: Partial<RecallableMemoryItem> = {}): RecallableMemoryItem {
  const { recall, metadata, ...rest } = overrides;
  return {
    id: rest.id ?? 'knack_eval',
    kind: rest.kind ?? 'knack',
    subtype: rest.subtype,
    summary: rest.summary ?? 'Context runtime recall item',
    recall: {
      trigger: recall?.trigger ?? {},
      applicableWhen: recall?.applicableWhen ?? ['Audit Context Runtime'],
      doNotApplyWhen: recall?.doNotApplyWhen ?? [],
      tags: recall?.tags,
      sourceRefs: recall?.sourceRefs,
      updatedAt: recall?.updatedAt,
    },
    metadata: {
      createdAt: FIXED_NOW,
      ...metadata,
    },
    payload: rest.payload ?? {},
  };
}

export function memoryResult(
  item: RecallableMemoryItem,
  total: number,
  dimensions: Partial<RecallScore['dimensions']> = {},
): MemoryRecallResult {
  return {
    item,
    score: score(total, dimensions),
  };
}

export function recalled(
  id: string,
  kind: RecalledItem['kind'],
  summary: string,
  total = 1,
): RecalledItem {
  return {
    id,
    kind,
    summary,
    reason: 'eval_fixture',
    score: score(total),
  };
}

export function recallBundle(overrides: Partial<RecallBundle> = {}): RecallBundle {
  return {
    knacks: [],
    preferences: [],
    docFindings: [],
    historicalTaskSnapshots: [],
    artifactRefs: [],
    runArchiveRefs: [],
    diagnostics: {
      queryText: '',
      triggerUsed: {},
      totalCandidates: 0,
      dropped: [],
      penalties: [],
    },
    ...overrides,
  };
}

function score(total: number, dimensions: Partial<RecallScore['dimensions']> = {}): RecallScore {
  const merged = {
    trigger: 0,
    keyword: 0,
    recency: 0,
    relevance: 0,
    metadata: 0,
    evidence: 0,
    ...dimensions,
  };
  return {
    dimensions: merged,
    trigger: merged.trigger,
    keyword: merged.keyword,
    metadata: merged.metadata,
    vector: 0,
    total,
  };
}
