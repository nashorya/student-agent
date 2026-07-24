import { describe, expect, it } from 'vitest';
import {
  buildChronicleGraph,
  serializeChronicleGraph,
  type BuildGraphInput,
} from '../knowledge-graph.js';

const sampleBuglog = `# Bug 档案

## BUG-004 · overfull-hbox 约束未进入近场
- **症状**：非法 synonym 跨 family
- **状态**：CLOSED

## BUG · 成本低估
- **症状**：本地 0.74 vs 网关 2.41
- **状态**：FIXED-部分
`;

const sampleAdr003 = `# ADR-003 · v0.4x 优先级重排

- **状态**：已采纳

### P0 · 离线蒸馏化验
text
### P1 · Lesson 准入门控
text
### P2 · 召回排序
text
### P3 · 利用可观测
text

## Tombstone（被否方向，勿重提）

| 方向 | 否决原因 |
|---|---|
| ⏸ 直接扩 lesson 量 | 病灶在写入质量 |
| ⏸ 调优召回 top-k | 垃圾召更多仍是垃圾 |
`;

const sampleJspace = `# ADR-099 · external jspace review

- **状态**：review

外部 J-space 的方向成立，但不应立即实现完整的认知操作系统。
`;

const sampleIndex = `# INDEX

## 纵向 · 时间轴

| 日期 | 事件 | 分支文档 |
|---|---|---|
| 2026-06-12 | 发现 BUG-004 并修复 | [buglog](buglog.md) |
`;

function input(overrides: Partial<BuildGraphInput> = {}): BuildGraphInput {
  return {
    buglogText: sampleBuglog,
    adrFiles: [
      { path: 'docs/adr/ADR-003-v04x-priority-reorder.md', text: sampleAdr003 },
      { path: 'docs/adr/external_jspace_architecture_review.md', text: sampleJspace },
    ],
    indexText: sampleIndex,
    distillationFiles: [
      {
        path: 'evals/distillation/p1-phase2b-zenmux-harness-report.json',
        text: JSON.stringify({ resolvedRate: 0.5, officialGatewayCostUsd: 2.41, note: 'P1 harness' }),
      },
    ],
    todoText: 'next: phase:P2 and injection',
    ...overrides,
  };
}

describe('chronicle knowledge graph', () => {
  it('parses five entity kinds and six edge kinds from fixtures', () => {
    const graph = buildChronicleGraph(input());
    const kinds = new Set(graph.nodes.map((n) => n.kind));
    expect(kinds.has('bug')).toBe(true);
    expect(kinds.has('adr')).toBe(true);
    expect(kinds.has('phase')).toBe(true);
    expect(kinds.has('campaign')).toBe(true);
    expect(kinds.has('finding')).toBe(true);
    const edgeKinds = new Set(graph.edges.map((e) => e.kind));
    expect(edgeKinds.has('tombstones')).toBe(true);
    expect(edgeKinds.has('requires')).toBe(true);
    expect(edgeKinds.has('verifies')).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'BUG-004')?.status).toContain('CLOSED');
  });

  it('reports parse errors with path+line and does not skip silently', () => {
    const graph = buildChronicleGraph(input({
      buglogText: `${sampleBuglog}\n## BUG-099 · missing status only\n- **症状**：x\n`,
    }));
    expect(graph.parseErrors.some((e) => e.message.includes('BUG-099') && e.line > 0)).toBe(true);
  });

  it('does not let a following NOTE overwrite the preceding bug status', () => {
    const graph = buildChronicleGraph(input({
      buglogText: [
        '## BUG-013 · extractor',
        '- **状态**：FIXED-v5',
        '## NOTE · audit note',
        '- **状态**：VERIFIED',
        '## BUG-014 · citation',
        '- **状态**：OPEN',
      ].join('\n'),
    }));

    expect(graph.nodes.find((node) => node.id === 'BUG-013')?.status).toBe('FIXED-v5');
    expect(graph.nodes.find((node) => node.id === 'BUG-014')?.status).toBe('OPEN');
  });

  it('is byte-deterministic across two builds', () => {
    const a = serializeChronicleGraph(buildChronicleGraph(input()));
    const b = serializeChronicleGraph(buildChronicleGraph(input()));
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(100);
  });

  it('answers the three dashboard acceptance questions', () => {
    const graph = buildChronicleGraph(input());
    expect(graph.answers.bug011).toMatch(/BUG-011|BUG-004/);
    expect(graph.answers.jspaceTombstone?.toLowerCase()).toMatch(/j-space|jspace|tombstone|认知/);
    expect(graph.answers.injectionMissing).toMatch(/注入|phase:P/);
  });

  it('lists next actions when prerequisites are closed', () => {
    const graph = buildChronicleGraph(input());
    // P1/P0 forced closed in wireDomainEdges; injection still needs P3
    expect(graph.nextActions.some((id) => id.includes('injection') || id.includes('P2') || id.includes('P3'))).toBe(true);
  });

  it('parses 图关系 defines / consumed-by from ADR docs (not parser special-cases)', () => {
    const adr004 = `# ADR-004 · Knack Schema v1

- **状态**：已采纳

## 图关系

- **defines** → \`finding:knack-schema-v1\` · Knack Schema v1
- **consumed-by** → \`phase:P1\` · P1 供给管道
`;
    const adr005 = `# ADR-005 · Recall Ranking

- **状态**：已采纳

## 图关系

- **defines** → \`phase:P2\` · 召回排序
`;
    const adr006 = `# ADR-006 · Citation

- **状态**：已采纳

## 图关系

- **defines** → \`phase:P3\` · 利用可观测
`;
    const graph = buildChronicleGraph(input({
      adrFiles: [
        { path: 'docs/adr/ADR-003-v04x-priority-reorder.md', text: sampleAdr003 },
        { path: 'docs/adr/ADR-004-knack-schema-v1.md', text: adr004 },
        { path: 'docs/adr/ADR-005-recall-ranking-protocol.md', text: adr005 },
        { path: 'docs/adr/ADR-006-recall-citation-and-credit.md', text: adr006 },
        { path: 'docs/adr/external_jspace_architecture_review.md', text: sampleJspace },
      ],
    }));

    const edgeIds = new Set(graph.edges.map((e) => e.id));
    expect(edgeIds.has('produces:ADR-004->finding:knack-schema-v1')).toBe(true);
    expect(edgeIds.has('produces:finding:knack-schema-v1->phase:P1')).toBe(true);
    expect(edgeIds.has('requires:phase:P1->finding:knack-schema-v1')).toBe(true);
    expect(edgeIds.has('produces:ADR-005->phase:P2')).toBe(true);
    expect(edgeIds.has('produces:ADR-006->phase:P3')).toBe(true);

    const adrs = graph.nodes.filter((n) => n.kind === 'adr');
    expect(adrs.length).toBeGreaterThanOrEqual(5); // 003-006 + jspace slug
    for (const a of adrs) {
      const count = graph.edgeCoverage.inventory.find((e) => e.id === a.id)?.edgeCount ?? 0;
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('reports edgeCoverage inventory and never hides zero-edge nodes', () => {
    const graph = buildChronicleGraph(input({
      buglogText: `${sampleBuglog}\n## BUG-088 · island\n- **状态**：OPEN\n`,
    }));
    expect(graph.edgeCoverage.inventory.some((e) => e.id === 'BUG-088')).toBe(true);
    expect(graph.edgeCoverage.unconnected.some((e) => e.id === 'BUG-088')).toBe(true);
    // connected bugs not in unconnected
    expect(graph.edgeCoverage.unconnected.some((e) => e.id === 'BUG-004')).toBe(false);
  });
});
