import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { parseAdrMarkdown, parseBuglogMarkdown, parseIndexMarkdown } from './adapters/canonical-markdown.js';
import { defaultArchiveConfig, discoverArchive, type ArchiveDiscoveryResult } from './discovery.js';
import { renderArchiveHtml } from './html-renderer.js';
import { PendingArchiveActionStore, type PendingArchiveAction, type PendingArchiveActionInput } from './pending-actions.js';
import { readArchiveText } from './text-integrity.js';
import type { ArchiveAdr, ArchiveBug, ArchiveConfig, ArchiveEvidence, ArchiveProject, ArchiveTimelineEntry, ArchiveValidationResult, BugStatus } from './types.js';
import { validateAdrTransition, validateArchive, validateBugTransition } from './validate.js';

export interface ArchiveBuildResult { dashboardPath: string; validation: ArchiveValidationResult; project: ArchiveProject; }
export interface ArchiveApplyResult extends ArchiveBuildResult { applied: string[]; adrs: ArchiveAdr[]; bugs: ArchiveBug[]; }
export interface ArchiveStatusResult { discovery: ArchiveDiscoveryResult; validation: ArchiveValidationResult; pendingActions: number; }

export class ArchiveService {
  readonly root: string;
  readonly config: ArchiveConfig;
  readonly actions: PendingArchiveActionStore;
  constructor(options: { root: string; config?: Partial<ArchiveConfig> }) {
    this.root = resolve(options.root);
    this.config = { ...defaultArchiveConfig(), ...options.config };
    this.actions = new PendingArchiveActionStore(this.root);
  }

  async read(): Promise<ArchiveProject> {
    const discovery = await discoverArchive(this.root, this.config);
    const { paths } = discovery;
    const project: ArchiveProject = {
      root: this.root, title: basename(this.root), ...paths, timeline: [], adrs: [], bugs: [], evidence: [], sourceHashes: {},
    };
    const index = await this.readOptional(paths.indexPath);
    if (index) { project.timeline = parseIndexMarkdown(index.text, paths.indexPath); project.sourceHashes[paths.indexPath] = index.sha256; }
    const buglog = await this.readOptional(paths.buglogPath);
    if (buglog) { project.bugs = parseBuglogMarkdown(buglog.text, paths.buglogPath); project.sourceHashes[paths.buglogPath] = buglog.sha256; }
    const adrDirectory = this.projectPath(paths.adrDir);
    try {
      const names = (await readdir(adrDirectory)).filter((name) => name.toLowerCase().endsWith('.md')).sort();
      for (const name of names) {
        const relative = `${paths.adrDir}/${name}`;
        const source = await readArchiveText(this.projectPath(relative));
        project.adrs.push(parseAdrMarkdown(source.text, relative));
        project.sourceHashes[relative] = source.sha256;
      }
    } catch (error) { if (!isMissing(error)) throw error; }
    project.evidence = [...project.bugs.flatMap((bug) => bug.evidence)];
    return project;
  }

  async status(): Promise<ArchiveStatusResult> {
    const discovery = await discoverArchive(this.root, this.config);
    const project = await this.read();
    return { discovery, validation: validateArchive(project), pendingActions: (await this.actions.list()).filter((item) => item.status === 'pending').length };
  }

  async init(): Promise<ArchiveBuildResult> {
    const discovery = await discoverArchive(this.root, this.config);
    await mkdir(this.projectPath(discovery.paths.adrDir), { recursive: true });
    await this.writeIfMissing(discovery.paths.indexPath, '# Project history\n\n| Date | Event | Details |\n|---|---|---|\n');
    await this.writeIfMissing(discovery.paths.buglogPath, '# Bug log\n');
    return this.build();
  }

  async check(): Promise<ArchiveValidationResult> { return validateArchive(await this.read()); }

  async build(): Promise<ArchiveBuildResult> {
    const project = await this.read();
    const validation = validateArchive(project);
    await atomicWrite(this.projectPath(project.dashboardPath), renderArchiveHtml(project));
    return { dashboardPath: project.dashboardPath, validation, project };
  }

  async stage(input: PendingArchiveActionInput): Promise<PendingArchiveAction> { return this.actions.stage(input); }
  async pending(taskId?: string): Promise<PendingArchiveAction[]> { return this.actions.list(taskId); }

  async apply(inputs: PendingArchiveActionInput[], evidence: ArchiveEvidence[] = []): Promise<ArchiveApplyResult> {
    const discovery = await discoverArchive(this.root, this.config);
    if (discovery.writeMode === 'blocked') throw new Error(`Archive write blocked: ${discovery.conflicts.join(', ')}`);
    if (discovery.initializationRequired) throw new Error('Archive initialization is required before writing');
    const current = await this.read();
    const candidate = structuredClone(current);
    candidate.evidence.push(...evidence);
    for (const input of inputs) applyAction(candidate, input, evidence);
    const validation = validateArchive(candidate);
    if (!validation.ok) throw new Error(validation.errors.map((item) => item.code).join(', '));

    const writes = serializeProject(candidate);
    for (const [relative, text] of writes) validateSerialized(relative, text);
    for (const [relative, text] of writes) await atomicWrite(this.projectPath(relative), text);
    const rebuilt = await this.build();
    return { ...rebuilt, applied: inputs.map((item) => item.key), adrs: rebuilt.project.adrs, bugs: rebuilt.project.bugs };
  }

  async applyPending(taskId: string, evidence: ArchiveEvidence[]): Promise<ArchiveApplyResult> {
    const actions = (await this.actions.list(taskId)).filter((item) => item.status === 'pending');
    const result = await this.apply(actions, evidence);
    await this.actions.markApplied(actions.map((item) => item.key));
    return result;
  }

  async acceptAdr(adrId: string, evidenceRef: string): Promise<ArchiveApplyResult> {
    return this.apply([{ key: `accept:${adrId}:${evidenceRef}`, taskId: 'user-review', type: 'accept_adr', entityId: adrId, payload: { evidenceRef } }]);
  }

  private projectPath(relative: string): string {
    const path = resolve(this.root, relative);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) throw new Error(`Archive path escapes project root: ${relative}`);
    return path;
  }
  private async readOptional(relative: string): Promise<{ text: string; sha256: string } | undefined> {
    try { return await readArchiveText(this.projectPath(relative)); }
    catch (error) { if (isMissing(error)) return undefined; throw error; }
  }
  private async writeIfMissing(relative: string, text: string): Promise<void> {
    try { await readArchiveText(this.projectPath(relative)); }
    catch (error) { if (isMissing(error)) await atomicWrite(this.projectPath(relative), text); else throw error; }
  }
}

function applyAction(project: ArchiveProject, action: PendingArchiveActionInput, evidence: ArchiveEvidence[]): void {
  const now = new Date().toISOString();
  if (action.type === 'create_adr') {
    const id = stringValue(action.payload.id) || nextId(project.adrs.map((item) => item.id), 'ADR');
    project.adrs.push({ id, title: stringValue(action.payload.title) || id, date: stringValue(action.payload.date) || now.slice(0, 10), decisionStatus: (stringValue(action.payload.decisionStatus) || 'proposed') as ArchiveAdr['decisionStatus'], implementationStatus: (stringValue(action.payload.implementationStatus) || 'planned') as ArchiveAdr['implementationStatus'], body: stringValue(action.payload.body) || stringValue(action.payload.summary), sourcePath: `${project.adrDir}/${id}-${slug(stringValue(action.payload.title) || 'decision')}.md`, history: [{ at: now, summary: 'ADR created' }] });
    return;
  }
  if (action.type === 'update_adr' || action.type === 'accept_adr') {
    const adr = project.adrs.find((item) => item.id === action.entityId); if (!adr) throw new Error(`Unknown ADR: ${action.entityId}`);
    const target = action.type === 'accept_adr' ? 'accepted' : (stringValue(action.payload.decisionStatus) as ArchiveAdr['decisionStatus'] || adr.decisionStatus);
    const evidenceRef = stringValue(action.payload.evidenceRef);
    const issues = validateAdrTransition(adr.decisionStatus, target, evidenceRef); if (issues.length) throw new Error(issues.map((item) => item.code).join(', '));
    adr.decisionStatus = target; if (stringValue(action.payload.implementationStatus)) adr.implementationStatus = stringValue(action.payload.implementationStatus) as ArchiveAdr['implementationStatus'];
    if (target === 'accepted') adr.acceptance = { acceptedAt: now, acceptedBy: 'user', evidenceRef };
    adr.history.push({ at: now, summary: stringValue(action.payload.summary) || `ADR ${target}`, evidenceRef: evidenceRef || undefined }); return;
  }
  if (action.type === 'create_bug') {
    const id = stringValue(action.payload.id) || nextId(project.bugs.map((item) => item.id), 'BUG');
    project.bugs.push({ id, title: stringValue(action.payload.title) || id, status: 'OPEN', symptom: stringValue(action.payload.symptom) || stringValue(action.payload.summary), evidence: [], history: [{ at: now, summary: 'Bug opened' }], sourcePath: project.buglogPath }); return;
  }
  if (action.type === 'update_bug') {
    const bug = project.bugs.find((item) => item.id === action.entityId); if (!bug) throw new Error(`Unknown bug: ${action.entityId}`);
    const target = (stringValue(action.payload.status) || bug.status) as BugStatus; const issues = validateBugTransition(bug.status, target, evidence); if (issues.length) throw new Error(issues.map((item) => item.code).join(', '));
    bug.status = target; bug.evidence.push(...evidence); bug.history.push({ at: now, summary: stringValue(action.payload.summary) || `Bug ${target}` }); return;
  }
  const id = `INDEX-${project.timeline.length + 1}`;
  project.timeline.push({ id, date: stringValue(action.payload.date) || now.slice(0, 10), title: stringValue(action.payload.title) || stringValue(action.payload.summary), summary: stringValue(action.payload.summary), kind: 'change' });
}

function serializeProject(project: ArchiveProject): Map<string, string> {
  const writes = new Map<string, string>();
  writes.set(project.indexPath, serializeIndex(project.timeline)); writes.set(project.buglogPath, serializeBuglog(project.bugs));
  for (const adr of project.adrs) writes.set(adr.sourcePath, serializeAdr(adr)); return writes;
}
function serializeAdr(adr: ArchiveAdr): string {
  const acceptance = adr.acceptance ? `accepted_at: ${adr.acceptance.acceptedAt}\nacceptance_evidence: ${adr.acceptance.evidenceRef}\n` : '';
  return `---\nid: ${adr.id}\ntitle: ${singleLine(adr.title)}\ndate: ${adr.date}\ndecision_status: ${adr.decisionStatus}\nimplementation_status: ${adr.implementationStatus}\n${acceptance}---\n\n${adr.body.trim()}\n\n## History\n${adr.history.map((item) => `- ${item.at}: ${singleLine(item.summary)}${item.evidenceRef ? ` (${item.evidenceRef})` : ''}`).join('\n')}\n`;
}
function serializeBuglog(bugs: ArchiveBug[]): string { return `# Bug log\n\n${bugs.map((bug) => `## ${bug.id} · ${bug.title}\n\n**状态**：${bug.status}\n**症状**：${bug.symptom}\n${bug.rootCause ? `**根因**：${bug.rootCause}\n` : ''}${bug.fix ? `**修复**：${bug.fix}\n` : ''}${bug.evidence.map((item) => `**验证**：${item.status}: ${item.summary}`).join('\n')}\n`).join('\n')}`; }
function serializeIndex(entries: ArchiveTimelineEntry[]): string { return `# Project history\n\n| Date | Event | Details |\n|---|---|---|\n${entries.map((item) => `| ${singleLine(item.date)} | ${singleLine(item.title)} | ${singleLine(item.summary)} |`).join('\n')}\n`; }
function validateSerialized(relative: string, text: string): void { if (text.includes('\0')) throw new Error(`Serialized archive contains NUL: ${relative}`); new TextEncoder().encode(text); }
async function atomicWrite(path: string, text: string): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`); await writeFile(temporary, text, 'utf8'); await rename(temporary, path); }
function nextId(ids: string[], prefix: string): string { const next = Math.max(0, ...ids.map((id) => Number(id.match(/\d+/)?.[0] ?? 0))) + 1; return `${prefix}-${String(next).padStart(3, '0')}`; }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'decision'; }
function singleLine(value: string): string { return value.replace(/[|\r\n]+/g, ' ').trim(); }
function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function isMissing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'; }
