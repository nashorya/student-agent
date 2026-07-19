/**
 * Build docs/chronicle-graph.json + docs/dashboard.html from repo docs (read-only parse).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  loadRepoGraphSources,
  buildChronicleGraph,
  serializeChronicleGraph,
} from '../src/archive/knowledge-graph.js';
import { renderKnowledgeDashboardHtml } from '../src/archive/knowledge-dashboard.js';

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const sources = await loadRepoGraphSources(root);
  const graph = buildChronicleGraph(sources);
  const graphPath = resolve(root, 'docs/chronicle-graph.json');
  const dashPath = resolve(root, 'docs/dashboard.html');
  await mkdir(dirname(graphPath), { recursive: true });
  await writeFile(graphPath, serializeChronicleGraph(graph), 'utf8');
  await writeFile(dashPath, renderKnowledgeDashboardHtml(graph, 'Student Agent'), 'utf8');
  console.log(JSON.stringify({
    graphPath,
    dashPath,
    contentHash: graph.contentHash,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    nextActions: graph.nextActions,
    parseErrors: graph.parseErrors.length,
    answers: graph.answers,
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
