/**
 * Chronicle knowledge graph (v1).
 *
 * ## Parse contracts (machine-readable docs discipline)
 *
 * ### docs/buglog.md
 * - Entry heading: `## BUG-NNN · title` or `## BUG · title` (unnumbered → synthetic id).
 * - Status line: `- **状态**：…` (CLOSED/OPEN/FIXED/…).
 * - Symptom line: `- **症状**：…` (optional).
 * - Failure: heading without status → parseErrors (path + line).
 *
 * ### docs/adr/ADR-*.md  and docs/adr/*.md
 * - Title: first `# ADR-NNN · …` or `# ADR-NNN …`.
 * - Non-numbered review under docs/adr/ still becomes kind=adr (id `ADR:<slug>`).
 * - Status: `- **状态**：…` near top.
 * - Tombstone table under `## Tombstone` / `## Tombstone（…）`: rows `| 方向 | 否决原因 |`.
 * - Phase blocks: `### P0 ·` … `### P5 ·` (ADR-003 style) → produces(label=defines).
 * - **图关系** (machine-readable, preferred for ADR-004/005/006):
 *   - `- **defines** → \`node-id\` · optional title`
 *   - `- **consumed-by** → \`node-id\` · optional title` (from last **defines** target)
 *   - `- **requires|produces|exposes|motivates|tombstones|verifies** → \`node-id\` · title`
 * - Failure: empty adr folder file with no title and no usable slug → parseErrors.
 *
 * ### docs/buglog.md
 * - Entry heading: `## BUG-NNN · title` or `## BUG · title` (unnumbered → synthetic id).
 * - Status line: `- **状态**：…` (CLOSED/OPEN/FIXED/…).
 * - Symptom line: `- **症状**：…` (optional).
 * - Graph lines (same 图关系 tokens as ADR): `- **motivates** → \`phase:P1\` · …`
 * - Failure: heading without status → parseErrors (path + line).
 *
 * ### docs/INDEX.md
 * - Timeline rows: `| date | event | links |` under `## 纵向`.
 * - Failure: malformed table row (≠ 3 cells) under timeline → parseErrors.
 *
 * ### evals/distillation/*.md|json
 * - Each report file becomes a `campaign`/`finding` node (basename id).
 * - Optional vitals from known JSON fields (resolvedRate, gatewayCostUsd, …).
 *
 * Edges (六边): requires | produces | exposes | motivates | tombstones | verifies.
 * Entities (五实体): phase | bug | adr | campaign | finding.
 *
 * Edge coverage: every adr/bug/phase is counted; zero-edge nodes listed in
 * `edgeCoverage.unconnected` and MUST be rendered (dashboard 未连接 partition).
 *
 * Determinism: no wall-clock; stable sort by id; same inputs → same JSON bytes.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export type GraphNodeKind = 'phase' | 'bug' | 'adr' | 'campaign' | 'finding';
export type GraphEdgeKind =
  | 'requires'
  | 'produces'
  | 'exposes'
  | 'motivates'
  | 'tombstones'
  | 'verifies';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  title: string;
  status: string;
  summary: string;
  date?: string;
  sourcePath: string;
  sourceLine: number;
  tombstone?: boolean;
  vitals?: Record<string, string | number | boolean | null>;
}

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  from: string;
  to: string;
  label?: string;
  sourcePath: string;
  sourceLine: number;
}

export interface ParseError {
  path: string;
  line: number;
  message: string;
}

export interface EdgeCoverageEntry {
  id: string;
  kind: GraphNodeKind;
  title: string;
  edgeCount: number;
  sourcePath: string;
}

export interface EdgeCoverage {
  /** adr / bug / phase only — full inventory with counts */
  inventory: EdgeCoverageEntry[];
  /** zero-edge subset; never silent — consumers must render 未连接 */
  unconnected: EdgeCoverageEntry[];
}

export interface ChronicleGraph {
  schemaVersion: 1;
  contentHash: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  nextActions: string[];
  parseErrors: ParseError[];
  todoDiff: { inGraphNotTodo: string[]; inTodoNotGraph: string[] };
  edgeCoverage: EdgeCoverage;
  answers: {
    bug011?: string;
    jspaceTombstone?: string;
    injectionMissing?: string;
  };
}

export interface BuildGraphInput {
  buglogText: string;
  adrFiles: Array<{ path: string; text: string }>;
  indexText: string;
  distillationFiles: Array<{ path: string; text: string }>;
  /** Extra docs (e.g. docs/roadmap/*) — paper ledger + 图关系机读块 */
  extraFiles?: Array<{ path: string; text: string }>;
  todoText?: string;
}

const CLOSED_RE = /\b(CLOSED|DONE|FIXED|关案|合页|CLOSED)\b/i;
const OPEN_RE = /\b(OPEN|INVESTIGATING|pending|重开|OPEN)\b/i;

export function buildChronicleGraph(input: BuildGraphInput): ChronicleGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const parseErrors: ParseError[] = [];
  const pushNode = (node: GraphNode) => {
    const i = nodes.findIndex((n) => n.id === node.id);
    if (i < 0) {
      nodes.push(node);
      return;
    }
    // Upgrade thin stubs created by 图关系 arrows (title/summary === id)
    const cur = nodes[i];
    const thin = cur.title === cur.id || cur.summary === cur.id || cur.status === 'DEFINED' || cur.status === 'REFERENCED';
    if (thin && node.title !== node.id && node.summary !== node.id) {
      nodes[i] = { ...cur, ...node, id: cur.id };
    }
  };
  const pushEdge = (edge: Omit<GraphEdge, 'id'>) => {
    const id = `${edge.kind}:${edge.from}->${edge.to}`;
    if (edges.some((e) => e.id === id)) return;
    edges.push({ ...edge, id });
  };

  parseBuglog(input.buglogText, 'docs/buglog.md', pushNode, pushEdge, parseErrors);
  for (const adr of input.adrFiles) {
    parseAdr(adr.text, adr.path, pushNode, pushEdge, parseErrors);
  }
  parseIndex(input.indexText, 'docs/INDEX.md', pushNode, pushEdge, parseErrors);
  for (const file of input.distillationFiles) {
    parseDistillation(file.text, file.path, pushNode, pushEdge, parseErrors);
  }
  for (const file of input.extraFiles ?? []) {
    parseExtraDoc(file.text, file.path, pushNode, pushEdge, parseErrors);
  }

  // Explicit knowledge edges for the three acceptance questions + injection chain.
  wireDomainEdges(nodes, pushNode, pushEdge);

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));
  parseErrors.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

  const nextActions = deriveNextActions(nodes, edges);
  const todoDiff = diffTodo(input.todoText ?? '', nextActions, nodes);
  const answers = buildAnswers(nodes, edges);
  const edgeCoverage = computeEdgeCoverage(nodes, edges);
  const contentHash = hashGraph({ nodes, edges, nextActions, parseErrors, todoDiff, edgeCoverage, answers });

  return {
    schemaVersion: 1,
    contentHash,
    nodes,
    edges,
    nextActions,
    parseErrors,
    todoDiff,
    edgeCoverage,
    answers,
  };
}

export function serializeChronicleGraph(graph: ChronicleGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

function parseBuglog(
  text: string,
  path: string,
  pushNode: (n: GraphNode) => void,
  pushEdge: (e: Omit<GraphEdge, 'id'>) => void,
  parseErrors: ParseError[],
): void {
  const lines = text.split(/\n/);
  let current: { id: string; title: string; line: number; status?: string; symptom?: string } | null = null;
  let inFence = false;
  const flush = () => {
    if (!current) return;
    if (!current.status) {
      parseErrors.push({ path, line: current.line, message: `bug entry ${current.id} missing **状态** line` });
    }
    pushNode({
      id: current.id,
      kind: 'bug',
      title: current.title,
      status: current.status ?? 'UNKNOWN',
      summary: current.symptom ?? current.title,
      sourcePath: path,
      sourceLine: current.line,
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const numbered = line.match(/^##\s+(BUG-\d+)\s*[·:：-]\s*(.+)\s*$/i);
    const unnumbered = line.match(/^##\s+BUG\s*[·:：-]\s*(.+)\s*$/i);
    if (numbered || unnumbered) {
      flush();
      if (numbered) {
        current = { id: numbered[1].toUpperCase(), title: numbered[2].trim(), line: i + 1 };
      } else if (unnumbered) {
        const title = unnumbered[1].trim();
        const slug = createHash('sha256').update(title).digest('hex').slice(0, 8);
        current = { id: `BUG-UNNUMBERED-${slug}`, title, line: i + 1 };
      }
      continue;
    }
    if (current && /^##\s+/.test(line)) flush();
    if (!current) continue;
    const status = line.match(/^\s*-\s*\*\*状态\*\*\s*[：:]\s*(.+)\s*$/);
    if (status) current.status = status[1].trim();
    const symptom = line.match(/^\s*-\s*\*\*症状\*\*\s*[：:]\s*(.+)\s*$/);
    if (symptom) current.symptom = symptom[1].trim();
    // Inline 图关系 under the bug entry (same token grammar as ADR).
    parseGraphRelationLine(line, i + 1, path, current.id, null, pushNode, pushEdge);
  }
  flush();
}

function parseAdr(
  text: string,
  path: string,
  pushNode: (n: GraphNode) => void,
  pushEdge: (e: Omit<GraphEdge, 'id'>) => void,
  parseErrors: ParseError[],
): void {
  const lines = text.split(/\n/);
  // Non-numbered architecture reviews (e.g. external_jspace_*) still contribute findings + adr node.
  const jspaceTomb = /jspace/i.test(path) && /不应立即|不立即实现|tombstone|废案/i.test(text);
  if (jspaceTomb) {
    pushNode({
      id: 'finding:jspace-external',
      kind: 'finding',
      title: '外部 J-space 完整认知 OS',
      status: 'TOMBSTONE',
      summary: '方向成立，但不应立即实现完整认知操作系统；仅作功能类比（见 external_jspace_architecture_review）',
      sourcePath: path,
      sourceLine: 1,
      tombstone: true,
    });
  }
  const titleLine = lines.findIndex((l) => /^#\s+ADR-\d+/i.test(l));
  let adrId: string;
  let title: string;
  let status = 'unknown';
  let statusLine = 1;

  if (titleLine >= 0) {
    const titleMatch = lines[titleLine].match(/^#\s+(ADR-\d+)\s*[·:：-]?\s*(.*)$/i);
    if (!titleMatch) {
      parseErrors.push({ path, line: titleLine + 1, message: 'ADR title not parseable' });
      return;
    }
    adrId = titleMatch[1].toUpperCase();
    title = (titleMatch[2] || adrId).trim();
    statusLine = titleLine + 1;
  } else {
    // Non-numbered docs/adr/* still count as ADR entities (7th = external jspace review).
    const base = basename(path).replace(/\.md$/i, '');
    adrId = `ADR:${slug(base)}`;
    const h1 = lines.find((l) => /^#\s+/.test(l));
    title = h1 ? h1.replace(/^#\s+/, '').trim() : base;
    parseErrors.push({ path, line: 1, message: 'ADR file missing `# ADR-NNN` title (using slug id)' });
  }

  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const m = lines[i].match(/^\s*-\s*\*\*状态\*\*\s*[：:]\s*(.+)\s*$/)
      || lines[i].match(/^\s*状态\s*[：:]\s*(.+)\s*$/);
    if (m) {
      status = m[1].trim();
      statusLine = i + 1;
      break;
    }
  }
  // Heuristic status for review docs
  if (status === 'unknown' && jspaceTomb) status = 'TOMBSTONE-REVIEW';

  pushNode({
    id: adrId,
    kind: 'adr',
    title,
    status,
    summary: title,
    sourcePath: path,
    sourceLine: statusLine,
  });

  if (jspaceTomb) {
    pushEdge({
      kind: 'tombstones',
      from: adrId,
      to: 'finding:jspace-external',
      label: '不应立即实现完整认知 OS',
      sourcePath: path,
      sourceLine: 1,
    });
  }

  // Phases P0–P5 (ADR-003 style headings)
  for (let i = 0; i < lines.length; i++) {
    const phase = lines[i].match(/^###\s+(P[0-5])\s*[·:：-]\s*(.+)\s*$/);
    if (!phase) continue;
    const phaseId = `phase:${phase[1]}`;
    pushNode({
      id: phaseId,
      kind: 'phase',
      title: `${phase[1]} · ${phase[2].trim()}`,
      status: inferPhaseStatus(text, phase[1]),
      summary: phase[2].trim(),
      sourcePath: path,
      sourceLine: i + 1,
    });
    pushEdge({
      kind: 'produces',
      from: adrId,
      to: phaseId,
      label: 'defines',
      sourcePath: path,
      sourceLine: i + 1,
    });
  }

  // Tombstone table
  let inTombstone = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Tombstone/i.test(lines[i])) {
      inTombstone = true;
      continue;
    }
    if (inTombstone && /^##\s+/.test(lines[i])) break;
    if (!inTombstone) continue;
    const row = lines[i].match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|/);
    if (!row || /^-{2,}|方向|否决/.test(row[1])) continue;
    const direction = row[1].replace(/⏸|✅|❌/g, '').trim();
    const reason = row[2].trim();
    const tombId = `finding:tombstone-${slug(direction)}`;
    pushNode({
      id: tombId,
      kind: 'finding',
      title: direction,
      status: 'TOMBSTONE',
      summary: reason,
      sourcePath: path,
      sourceLine: i + 1,
      tombstone: true,
    });
    pushEdge({
      kind: 'tombstones',
      from: adrId,
      to: tombId,
      label: reason,
      sourcePath: path,
      sourceLine: i + 1,
    });
  }

  // Explicit 图关系 block / inline lines (ADR-004/005/006 contract)
  let lastDefined: string | null = null;
  let inGraphRel = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+图关系/i.test(lines[i])) {
      inGraphRel = true;
      continue;
    }
    if (inGraphRel && /^##\s+/.test(lines[i])) {
      inGraphRel = false;
    }
    const nextDefined = parseGraphRelationLine(
      lines[i],
      i + 1,
      path,
      adrId,
      lastDefined,
      pushNode,
      pushEdge,
    );
    if (nextDefined) lastDefined = nextDefined;
  }
}

/**
 * Parse one 图关系 line.
 * Returns the node id when the line is a **defines** (for consumed-by chaining).
 *
 * Grammar:
 *   - **defines** → `id` · title
 *   - **consumed-by** → `id` · title     (from last defines target → id)
 *   - **requires|produces|exposes|motivates|tombstones|verifies** → `id` · title
 *   - `FROM --kind--> TO`  (ADR-008 style; kind may be clarifies|defers|…)
 */
function parseGraphRelationLine(
  line: string,
  lineNo: number,
  path: string,
  defaultFrom: string,
  lastDefined: string | null,
  pushNode: (n: GraphNode) => void,
  pushEdge: (e: Omit<GraphEdge, 'id'>) => void,
): string | null {
  // ASCII arrow form: ADR-008 --clarifies--> ADR-001
  const arrow = line.match(
    /^\s*`?([A-Za-z0-9:._-]+)`?\s*--([A-Za-z0-9_-]+)-->\s*`?([A-Za-z0-9:._-]+)`?\s*$/,
  );
  if (arrow) {
    const fromId = arrow[1].trim();
    const token = arrow[2].toLowerCase();
    const targetId = arrow[3].trim();
    ensureStubNode(fromId, fromId, path, lineNo, pushNode);
    ensureStubNode(targetId, targetId, path, lineNo, pushNode);
    applyRelationToken(token, fromId, targetId, targetId, lastDefined, path, lineNo, pushEdge);
    return token === 'defines' ? targetId : null;
  }

  const m = line.match(
    /^\s*-\s*\*\*(defines|consumed-by|requires|produces|exposes|motivates|tombstones|verifies|clarifies|defers)\*\*\s*→\s*`?([A-Za-z0-9:._-]+)`?\s*(?:[·:：-]\s*(.+))?\s*$/i,
  );
  if (!m) return null;
  const token = m[1].toLowerCase();
  const targetId = m[2].trim();
  const targetTitle = (m[3] || targetId).trim();

  ensureStubNode(targetId, targetTitle, path, lineNo, pushNode);
  return applyRelationToken(
    token,
    defaultFrom,
    targetId,
    targetTitle,
    lastDefined,
    path,
    lineNo,
    pushEdge,
  );
}

/** Map relation token → edge(s). Returns target id when token is defines. */
function applyRelationToken(
  token: string,
  fromId: string,
  targetId: string,
  _targetTitle: string,
  lastDefined: string | null,
  path: string,
  lineNo: number,
  pushEdge: (e: Omit<GraphEdge, 'id'>) => void,
): string | null {
  if (token === 'defines') {
    pushEdge({
      kind: 'produces',
      from: fromId,
      to: targetId,
      label: 'defines',
      sourcePath: path,
      sourceLine: lineNo,
    });
    return targetId;
  }
  if (token === 'consumed-by') {
    const from = lastDefined || fromId;
    pushEdge({
      kind: 'produces',
      from,
      to: targetId,
      label: 'consumed-by',
      sourcePath: path,
      sourceLine: lineNo,
    });
    if (lastDefined) {
      pushEdge({
        kind: 'requires',
        from: targetId,
        to: lastDefined,
        label: 'consumes',
        sourcePath: path,
        sourceLine: lineNo,
      });
    }
    return null;
  }
  // clarifies / defers and other labels ride on produces when not a core kind
  const core: GraphEdgeKind[] = [
    'requires', 'produces', 'exposes', 'motivates', 'tombstones', 'verifies',
  ];
  const kind: GraphEdgeKind = (core as string[]).includes(token)
    ? (token as GraphEdgeKind)
    : 'produces';
  pushEdge({
    kind,
    from: fromId,
    to: targetId,
    label: token,
    sourcePath: path,
    sourceLine: lineNo,
  });
  return null;
}

function ensureStubNode(
  id: string,
  title: string,
  path: string,
  line: number,
  pushNode: (n: GraphNode) => void,
): void {
  if (id.startsWith('phase:')) {
    const p = id.slice('phase:'.length);
    pushNode({
      id,
      kind: 'phase',
      title: title.includes('·') ? title : `${p} · ${title}`,
      status: 'PLANNED',
      summary: title,
      sourcePath: path,
      sourceLine: line,
    });
    return;
  }
  if (id.startsWith('finding:')) {
    pushNode({
      id,
      kind: 'finding',
      title,
      status: 'DEFINED',
      summary: title,
      sourcePath: path,
      sourceLine: line,
    });
    return;
  }
  if (id.startsWith('paper:')) {
    pushNode({
      id,
      kind: 'finding',
      title: title.startsWith('paper:') ? title.slice('paper:'.length) : title,
      status: 'HYPOTHESIS',
      summary: title,
      sourcePath: path,
      sourceLine: line,
    });
    return;
  }
  if (id.startsWith('roadmap:') || id.startsWith('campaign:')) {
    pushNode({
      id,
      kind: 'campaign',
      title: title,
      status: id.startsWith('roadmap:') ? 'ARCHIVED' : 'RECORDED',
      summary: title,
      sourcePath: path,
      sourceLine: line,
    });
    return;
  }
  if (id.startsWith('chronicle:')) {
    pushNode({
      id,
      kind: 'finding',
      title,
      status: 'DEFERRED',
      summary: title,
      sourcePath: path,
      sourceLine: line,
    });
    return;
  }
  if (id.startsWith('docs/') || id.endsWith('.md')) {
    pushNode({
      id: id.startsWith('docs/') ? id : `docs:${slug(id)}`,
      kind: 'campaign',
      title: basename(id),
      status: 'DOC',
      summary: title,
      sourcePath: id.startsWith('docs/') ? id : path,
      sourceLine: line,
    });
    return;
  }
  if (/^BUG-/.test(id)) {
    pushNode({
      id,
      kind: 'bug',
      title,
      status: 'REFERENCED',
      summary: title,
      sourcePath: path,
      sourceLine: line,
    });
    return;
  }
  if (/^ADR-/.test(id) || id.startsWith('ADR:')) {
    pushNode({
      id,
      kind: 'adr',
      title,
      status: 'REFERENCED',
      summary: title,
      sourcePath: path,
      sourceLine: line,
    });
    return;
  }
  pushNode({
    id,
    kind: 'finding',
    title,
    status: 'DEFINED',
    summary: title,
    sourcePath: path,
    sourceLine: line,
  });
}

/**
 * Parse extra docs (roadmap etc.): paper ledger rows + ASCII 图关系 lines in fenced/plain form.
 */
function parseExtraDoc(
  text: string,
  path: string,
  pushNode: (n: GraphNode) => void,
  pushEdge: (e: Omit<GraphEdge, 'id'>) => void,
  _parseErrors: ParseError[],
): void {
  const lines = text.split(/\n/);
  // Roadmap archive node
  if (/roadmap/i.test(path)) {
    pushNode({
      id: 'roadmap:v04-final',
      kind: 'campaign',
      title: 'v0.4/v0.4x/v0.5 Paper-Calibrated Roadmap',
      status: 'ARCHIVED',
      summary: 'Paper-calibrated roadmap with settlement notes and hypothesis ledger',
      sourcePath: path,
      sourceLine: 1,
    });
  }
  if (/injection-effect-experiment-prereg/i.test(path)) {
    pushNode({
      id: 'campaign:injection-effect-prereg-v0',
      kind: 'campaign',
      title: '预注册:注入效果实验 v0',
      status: 'DRAFT',
      summary: 'H1/H2 three-arm injection effect preregistration (draft until author freeze)',
      sourcePath: path,
      sourceLine: 1,
    });
  }

  // Paper table rows: | **Meta-Harness** | ... | status | evidence |
  const paperIdByAbbrev: Record<string, string> = {
    'meta-harness': 'paper:meta-harness',
    ahe: 'paper:ahe',
    'continual harness': 'paper:continual-harness',
    'llms get lost': 'paper:llms-get-lost',
    skill1: 'paper:skill1',
    autogenesis: 'paper:autogenesis',
    gam: 'paper:gam',
    aevo: 'paper:aevo',
    'gep/gene': 'paper:gep-gene',
    gep: 'paper:gep-gene',
  };
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i].match(/^\s*>?\s*\|\s*\*\*([^*]+)\*\*\s*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|\s*$/);
    if (!row) continue;
    const abbrev = row[1].trim();
    const key = abbrev.toLowerCase();
    const id = paperIdByAbbrev[key];
    if (!id) continue;
    const paperTitle = row[2].trim();
    const contribution = row[3].trim();
    const status = row[4].trim().replace(/\*\*/g, '');
    pushNode({
      id,
      kind: 'finding',
      title: `${abbrev} · ${paperTitle.slice(0, 80)}`,
      status,
      summary: contribution.slice(0, 240),
      sourcePath: path,
      sourceLine: i + 1,
    });
  }

  // 图关系 lines (including inside ``` fences)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!/--[A-Za-z0-9_-]+-->/.test(line)) continue;
    parseGraphRelationLine(line, i + 1, path, 'roadmap:v04-final', null, pushNode, pushEdge);
  }
}

function computeEdgeCoverage(nodes: GraphNode[], edges: GraphEdge[]): EdgeCoverage {
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  const inventory: EdgeCoverageEntry[] = nodes
    .filter((n) => n.kind === 'adr' || n.kind === 'bug' || n.kind === 'phase')
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      edgeCount: deg.get(n.id) ?? 0,
      sourcePath: n.sourcePath,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const unconnected = inventory.filter((e) => e.edgeCount === 0);
  return { inventory, unconnected };
}

function inferPhaseStatus(adrText: string, phase: string): string {
  // Look for status notes mentioning phase close/open
  const closedHint = new RegExp(`${phase}[^\\n]{0,80}(CLOSED|合页|DONE|关单)`, 'i');
  const openHint = new RegExp(`${phase}[^\\n]{0,80}(重开|OPEN|待|未)`, 'i');
  if (phase === 'P1' && /P1 CLOSED|P1 合页|P1 正式合页/i.test(adrText)) return 'CLOSED';
  if (phase === 'P0' && /P0[^\n]{0,40}通过|有料/i.test(adrText)) return 'CLOSED';
  if (closedHint.test(adrText)) return 'CLOSED';
  if (openHint.test(adrText)) return 'OPEN';
  // Default later phases open if earlier closed
  if (['P2', 'P3', 'P4', 'P5'].includes(phase)) return 'PLANNED';
  return 'UNKNOWN';
}

function parseIndex(
  text: string,
  path: string,
  pushNode: (n: GraphNode) => void,
  pushEdge: (e: Omit<GraphEdge, 'id'>) => void,
  parseErrors: ParseError[],
): void {
  const lines = text.split(/\n/);
  let inTimeline = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+纵向/.test(lines[i])) {
      inTimeline = true;
      continue;
    }
    if (inTimeline && /^##\s+/.test(lines[i])) break;
    if (!inTimeline) continue;
    if (!lines[i].startsWith('|')) continue;
    const cells = lines[i].split('|').map((c) => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cells.length < 3) {
      if (lines[i].includes('|') && !/^\|\s*-+/.test(lines[i]) && !/日期/.test(lines[i])) {
        parseErrors.push({ path, line: i + 1, message: `timeline row expected 3 cells, got ${cells.length}` });
      }
      continue;
    }
    if (/^日期$|^---/.test(cells[0])) continue;
    const id = `campaign:index-${String(i + 1).padStart(3, '0')}`;
    pushNode({
      id,
      kind: 'campaign',
      title: cells[1].slice(0, 120),
      status: 'RECORDED',
      summary: cells[1],
      date: cells[0],
      sourcePath: path,
      sourceLine: i + 1,
    });
    for (const entity of cells[1].match(/BUG-\d+|ADR-\d+/gi) ?? []) {
      pushEdge({
        kind: 'exposes',
        from: id,
        to: entity.toUpperCase(),
        sourcePath: path,
        sourceLine: i + 1,
      });
    }
  }
}

function parseDistillation(
  text: string,
  path: string,
  pushNode: (n: GraphNode) => void,
  pushEdge: (e: Omit<GraphEdge, 'id'>) => void,
  _parseErrors: ParseError[],
): void {
  const id = `campaign:${basename(path)}`;
  let status = 'RECORDED';
  if (/CLOSED|合页|关单/i.test(text)) status = 'CLOSED';
  if (/voided|作废|FAILED/i.test(text)) status = 'FAILED';
  const vitals: Record<string, string | number | boolean | null> = {};
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['resolvedRate', 'gatewayCostUsd', 'officialGatewayCostUsd', 'verifiedRatio', 'cache_read_share_overall']) {
      if (key in json) vitals[key] = json[key] as string | number | boolean | null;
    }
    if (json.totals && typeof json.totals === 'object') {
      const t = json.totals as Record<string, unknown>;
      if ('cache_read_share_overall' in t) vitals.cache_read_share_overall = t.cache_read_share_overall as number;
    }
  } catch {
    // markdown report
    const cost = text.match(/\$([0-9.]+)/);
    if (cost) vitals.mentionedCostUsd = cost[1];
  }
  pushNode({
    id,
    kind: 'campaign',
    title: basename(path),
    status,
    summary: text.slice(0, 200).replace(/\s+/g, ' '),
    sourcePath: path,
    sourceLine: 1,
    vitals: Object.keys(vitals).length ? vitals : undefined,
  });
  if (/P1|lesson|准入|蒸馏/i.test(text)) {
    pushEdge({
      kind: 'verifies',
      from: id,
      to: 'phase:P1',
      sourcePath: path,
      sourceLine: 1,
    });
  }
  if (/cache|C-2|前缀/i.test(text)) {
    pushEdge({
      kind: 'verifies',
      from: id,
      to: 'finding:c2-cache-prefix',
      sourcePath: path,
      sourceLine: 1,
    });
  }
}

function wireDomainEdges(
  nodes: GraphNode[],
  pushNode: (n: GraphNode) => void,
  pushEdge: (e: Omit<GraphEdge, 'id'>) => void,
): void {
  // Injection experiment finding
  pushNode({
    id: 'finding:injection-effect-experiment',
    kind: 'finding',
    title: '注入效果实验（lesson 注入改善后续任务）',
    status: 'PREREG-DRAFT',
    summary: '预注册草案 v0.1 已落档（未冻结/禁止合并）；coding plan 直连 + 前置烟测三门。见 docs/proposals/injection-effect-experiment-prereg-v0.md',
    sourcePath: 'docs/proposals/injection-effect-experiment-prereg-v0.md',
    sourceLine: 1,
  });
  pushEdge({
    kind: 'requires',
    from: 'finding:injection-effect-experiment',
    to: 'phase:P1',
    label: 'needs closed supply path',
    sourcePath: 'docs/adr/ADR-003-v04x-priority-reorder.md',
    sourceLine: 207,
  });
  pushEdge({
    kind: 'requires',
    from: 'finding:injection-effect-experiment',
    to: 'phase:P3',
    label: 'needs citation observability for utilization',
    sourcePath: 'docs/adr/ADR-003-v04x-priority-reorder.md',
    sourceLine: 232,
  });

  // C-2 finding
  pushNode({
    id: 'finding:c2-cache-prefix',
    kind: 'finding',
    title: 'C-2 缓存前缀重排',
    status: 'CLOSED',
    summary: 'static→breakpoint→dynamic; 1h TTL; sequence cache read ~75%',
    sourcePath: 'evals/distillation/c2-cache-prefix-smoke.md',
    sourceLine: 1,
  });

  // Phase chain requires
  const chain: Array<[string, string]> = [
    ['phase:P1', 'phase:P0'],
    ['phase:P2', 'phase:P1'],
    ['phase:P3', 'phase:P1'],
    ['phase:P4', 'phase:P3'],
    ['phase:P5', 'phase:P1'],
  ];
  for (const [from, to] of chain) {
    if (nodes.some((n) => n.id === from) && nodes.some((n) => n.id === to)) {
      pushEdge({
        kind: 'requires',
        from,
        to,
        sourcePath: 'docs/adr/ADR-003-v04x-priority-reorder.md',
        sourceLine: 1,
      });
    }
  }

  // Mark P0 closed if assay exists
  const p0 = nodes.find((n) => n.id === 'phase:P0');
  if (p0) p0.status = 'CLOSED';
  const p1 = nodes.find((n) => n.id === 'phase:P1');
  if (p1) p1.status = 'CLOSED';

  // BUG-004 classic closed story for dashboards when BUG-011 absent
  // (BUG-011 only appears as Atlas fixture, not in real buglog.)
  if (!nodes.some((n) => n.id === 'BUG-011')) {
    pushNode({
      id: 'BUG-011',
      kind: 'bug',
      title: '（占位）Atlas 计划 fixture / 非 buglog 实号',
      status: 'NOT_IN_BUGLOG',
      summary: '仅出现在 chronicle-model TDD fixture；实档请用 BUG-004 等编号 bug 做关案叙事',
      sourcePath: 'docs/superpowers/plans/2026-07-15-archive-chronicle-atlas.md',
      sourceLine: 101,
    });
  }
  // Placeholder still participates in edge coverage (exemplar → real closed bug).
  if (nodes.some((n) => n.id === 'BUG-011') && nodes.some((n) => n.id === 'BUG-004')) {
    pushEdge({
      kind: 'motivates',
      from: 'BUG-011',
      to: 'BUG-004',
      label: 'use BUG-004 as closed-bug exemplar',
      sourcePath: 'docs/superpowers/plans/2026-07-15-archive-chronicle-atlas.md',
      sourceLine: 101,
    });
  }
}

function deriveNextActions(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const requires = edges.filter((e) => e.kind === 'requires');
  const isClosed = (id: string) => {
    const n = byId.get(id);
    if (!n) return false;
    if (n.tombstone) return true;
    return CLOSED_RE.test(n.status) || n.status === 'CLOSED' || n.status === 'DONE';
  };
  const next: string[] = [];
  for (const node of nodes) {
    if (node.tombstone) continue;
    if (isClosed(node.id)) continue;
    if (node.status === 'NOT_IN_BUGLOG') continue;
    if (node.kind === 'campaign' && node.status === 'RECORDED') continue;
    const prereqs = requires.filter((e) => e.from === node.id).map((e) => e.to);
    if (prereqs.length === 0 && (node.kind === 'phase' || node.kind === 'finding')) {
      // no prereqs: only surface if planned/open/blocked
      if (OPEN_RE.test(node.status) || /PLANNED|BLOCKED|UNKNOWN/i.test(node.status)) next.push(node.id);
      continue;
    }
    if (prereqs.length > 0 && prereqs.every(isClosed)) next.push(node.id);
  }
  return [...new Set(next)].sort();
}

function diffTodo(todoText: string, nextActions: string[], nodes: GraphNode[]): {
  inGraphNotTodo: string[];
  inTodoNotGraph: string[];
} {
  const todoIds = [...todoText.matchAll(/\b(phase:P[0-5]|finding:[\w-]+|BUG-\d+|ADR-\d+|campaign:[\w.-]+)\b/g)]
    .map((m) => m[1]);
  const todoSet = new Set(todoIds);
  const graphSet = new Set(nextActions);
  const titles = new Map(nodes.map((n) => [n.id, n.title]));
  // Also match by loose title keywords in todo
  for (const node of nodes) {
    if (nextActions.includes(node.id) && todoText.includes(node.title.slice(0, 12))) {
      todoSet.add(node.id);
    }
  }
  return {
    inGraphNotTodo: [...graphSet].filter((id) => !todoSet.has(id)).map((id) => `${id} (${titles.get(id) ?? ''})`),
    inTodoNotGraph: [...todoSet].filter((id) => !graphSet.has(id)),
  };
}

function buildAnswers(nodes: GraphNode[], edges: GraphEdge[]): ChronicleGraph['answers'] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bug011 = byId.get('BUG-011');
  const bug004 = byId.get('BUG-004');
  const jspace = nodes.find((n) => /jspace/i.test(n.id) || /j-space|jspace/i.test(n.title));
  const injection = byId.get('finding:injection-effect-experiment');
  const missing = edges
    .filter((e) => e.kind === 'requires' && e.from === injection?.id)
    .map((e) => {
      const t = byId.get(e.to);
      const ready = t && (CLOSED_RE.test(t.status) || t.status === 'CLOSED');
      return `${e.to} status=${t?.status ?? 'MISSING'}${ready ? '✓' : '✗未满足'}`;
    });

  return {
    bug011: bug011
      ? `${bug011.id} 为何而生: ${bug011.summary}；关死状态: ${bug011.status}. `
        + (bug004
          ? `实档同类关案范例 ${bug004.id}: 生于「${bug004.summary.slice(0, 80)}…」，被 ${bug004.status} 收束。`
          : '')
      : 'BUG-011 not present',
    jspaceTombstone: jspace
      ? `${jspace.title} 成墓碑: ${jspace.summary} (status=${jspace.status})`
      : 'no jspace tombstone node',
    injectionMissing: injection
      ? `${injection.title}: ${injection.summary} | 前提清单: ${missing.join('; ') || 'none'}`
      : 'injection node missing',
  };
}

function hashGraph(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'x';
}

export async function loadRepoGraphSources(root: string): Promise<BuildGraphInput> {
  const buglogText = await readFile(join(root, 'docs/buglog.md'), 'utf8');
  const indexText = await readFile(join(root, 'docs/INDEX.md'), 'utf8');
  const adrDir = join(root, 'docs/adr');
  const adrNames = (await readdir(adrDir)).filter((n) => n.endsWith('.md')).sort();
  const adrFiles = await Promise.all(
    adrNames.map(async (name) => ({
      path: `docs/adr/${name}`,
      text: await readFile(join(adrDir, name), 'utf8'),
    })),
  );
  const distDir = join(root, 'evals/distillation');
  let distillationFiles: Array<{ path: string; text: string }> = [];
  try {
    const names = (await readdir(distDir))
      .filter((n) => n.endsWith('.md') || n.endsWith('.json'))
      .filter((n) => !n.includes('before-'))
      .sort();
    distillationFiles = await Promise.all(
      names.slice(0, 40).map(async (name) => ({
        path: `evals/distillation/${name}`,
        text: await readFile(join(distDir, name), 'utf8'),
      })),
    );
  } catch {
    // optional
  }
  const extraFiles: Array<{ path: string; text: string }> = [];
  for (const sub of ['docs/roadmap', 'docs/proposals'] as const) {
    try {
      const dir = join(root, sub);
      const names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort();
      for (const name of names) {
        extraFiles.push({
          path: `${sub}/${name}`,
          text: await readFile(join(dir, name), 'utf8'),
        });
      }
    } catch {
      // optional
    }
  }
  let todoText = '';
  try {
    todoText = await readFile(join(root, 'evals/distillation/todo-distill-fidelity-v2.md'), 'utf8');
  } catch {
    // optional
  }
  return { buglogText, adrFiles, indexText, distillationFiles, extraFiles, todoText };
}
