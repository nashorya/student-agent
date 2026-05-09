import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { WriteQueue } from '../../core/write-queue.js';
import type {
  DesignActiveProfileFile,
  DesignCandidate,
  DesignCandidatesFile,
  DesignCritique,
  DesignCritiquesFile,
  DesignExtractionResult,
  DesignProvenance,
  StyleProfile,
} from './types.js';
import type { CandidateBreakerReport } from '../candidates/types.js';

const DEFAULT_ACTIVE_FILE: DesignActiveProfileFile = {
  profile_id: null,
  updated_at: new Date(0).toISOString(),
};

export class DesignMemoryManager {
  private static instance: DesignMemoryManager | null = null;
  private readonly candidatesPath: string;
  private readonly profilesDir: string;
  private readonly critiquesPath: string;
  private readonly activePath: string;

  constructor(memoryDir: string) {
    this.candidatesPath = join(memoryDir, 'design-candidates.json');
    this.profilesDir = join(memoryDir, 'design-profiles');
    this.critiquesPath = join(memoryDir, 'design-critiques.json');
    this.activePath = join(memoryDir, 'design-active-profile.json');
  }

  static getInstance(memoryDir?: string): DesignMemoryManager {
    const dir = memoryDir ?? `${process.cwd()}/memory`;
    if (!DesignMemoryManager.instance) {
      DesignMemoryManager.instance = new DesignMemoryManager(dir);
    }
    return DesignMemoryManager.instance;
  }

  static resetInstance(): void {
    DesignMemoryManager.instance = null;
  }

  async getCandidates(): Promise<DesignCandidate[]> {
    return (await this.readCandidatesFile()).candidates;
  }

  async findCandidate(id: string): Promise<DesignCandidate | null> {
    return (await this.getCandidates()).find((candidate) => candidate.id === id) ?? null;
  }

  async observeCandidate(result: DesignExtractionResult, params: {
    taskId: string;
    sessionRef: string;
    now?: Date;
  }): Promise<DesignCandidate> {
    return WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readCandidatesFile();
      const now = (params.now ?? new Date()).toISOString();
      const existingIndex = file.candidates.findIndex((candidate) =>
        candidate.name === result.name
        && sameStringSet(candidate.source_urls, result.sourceUrls),
      );

      if (existingIndex >= 0) {
        const existing = file.candidates[existingIndex];
        const updated = this.updateObservedCandidate(existing, result, params, now);
        file.candidates[existingIndex] = updated;
        await this.writeCandidates(file.candidates);
        return updated;
      }

      const candidate = this.createCandidate(result, params, now);
      await this.writeCandidates([...file.candidates, candidate]);
      return candidate;
    });
  }

  async confirmCandidate(candidateId: string, params: {
    taskId: string;
    sessionRef: string;
    now?: Date;
  }): Promise<StyleProfile> {
    return WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readCandidatesFile();
      const idx = file.candidates.findIndex((candidate) => candidate.id === candidateId);
      if (idx < 0) {
        throw new Error(`Design candidate not found: ${candidateId}`);
      }

      const now = (params.now ?? new Date()).toISOString();
      const candidate = file.candidates[idx];
      const profile = this.profileFromCandidate(candidate, params, now);

      file.candidates[idx] = {
        ...candidate,
        status: 'promoted',
        provenance: [
          ...candidate.provenance,
          makeProvenance('user-confirmed', params.taskId, params.sessionRef, now, 'user-confirmed'),
        ],
      };

      await this.writeCandidates(file.candidates);
      await this.writeProfile(profile);
      return profile;
    });
  }

  async recordBreakerReport(candidateId: string, report: CandidateBreakerReport): Promise<DesignCandidate | null> {
    return WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readCandidatesFile();
      const idx = file.candidates.findIndex((candidate) => candidate.id === candidateId);
      if (idx < 0) return null;
      const updated = { ...file.candidates[idx], breaker_report: report };
      file.candidates[idx] = updated;
      await this.writeCandidates(file.candidates);
      return updated;
    });
  }

  async getProfiles(): Promise<StyleProfile[]> {
    try {
      const files = await readdir(this.profilesDir);
      const profiles = await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map((file) => this.readProfileFile(join(this.profilesDir, file))),
      );
      return profiles.filter((profile): profile is StyleProfile => profile !== null);
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async getProfile(profileId: string): Promise<StyleProfile | null> {
    return this.readProfileFile(this.profilePath(profileId));
  }

  async upsertProfile(profile: StyleProfile): Promise<StyleProfile> {
    return WriteQueue.getInstance().enqueue(async () => {
      await this.writeProfile(profile);
      return profile;
    });
  }

  async copyProfileTo(profileId: string, target: DesignMemoryManager): Promise<StyleProfile> {
    const profile = await this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Design profile not found: ${profileId}`);
    }
    return target.upsertProfile({ ...profile, updated_at: new Date().toISOString() });
  }

  async setActiveProfile(profileId: string): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const profile = await this.readProfileFile(this.profilePath(profileId));
      if (!profile) {
        throw new Error(`Design profile not found: ${profileId}`);
      }
      const active = await this.getActiveFile();
      await this.writeActiveFile({ ...active, profile_id: profileId, updated_at: new Date().toISOString() });
    });
  }

  async getActiveProfile(): Promise<StyleProfile | null> {
    const active = await this.getActiveFile();
    return active.profile_id ? this.getProfile(active.profile_id) : null;
  }

  async setLocalUrl(url: string): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const active = await this.getActiveFile();
      await this.writeActiveFile({ ...active, local_url: url, updated_at: new Date().toISOString() });
    });
  }

  async getLocalUrl(): Promise<string | null> {
    return (await this.getActiveFile()).local_url ?? null;
  }

  async appendCritique(critique: DesignCritique): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readCritiquesFile();
      const withoutDuplicate = file.critiques.filter((item) => item.id !== critique.id);
      await this.writeCritiques([...withoutDuplicate, critique]);
    });
  }

  async getCritiques(): Promise<DesignCritique[]> {
    return (await this.readCritiquesFile()).critiques;
  }

  async getRecentUnresolvedCritiques(limit = 3): Promise<DesignCritique[]> {
    const critiques = await this.getCritiques();
    return critiques
      .filter((critique) => critique.revision_required)
      .slice(-limit);
  }

  private createCandidate(
    result: DesignExtractionResult,
    params: { taskId: string; sessionRef: string },
    now: string,
  ): DesignCandidate {
    return {
      id: `design_cand_${randomUUID()}`,
      name: result.name,
      source_urls: result.sourceUrls,
      screenshots: result.screenshots,
      samples: result.samples,
      tokens: result.tokens,
      component_patterns: result.componentPatterns,
      anti_patterns: result.antiPatterns,
      observations: 1,
      first_observed: now,
      last_observed: now,
      status: 'observed',
      breaker_report: null,
      provenance: [makeProvenance(result.provenanceSource, params.taskId, params.sessionRef, now, 'unverified')],
    };
  }

  private updateObservedCandidate(
    existing: DesignCandidate,
    result: DesignExtractionResult,
    params: { taskId: string; sessionRef: string },
    now: string,
  ): DesignCandidate {
    const observations = existing.observations + 1;
    return {
      ...existing,
      screenshots: result.screenshots,
      samples: result.samples,
      tokens: result.tokens,
      component_patterns: result.componentPatterns,
      anti_patterns: result.antiPatterns,
      observations,
      last_observed: now,
      provenance: [
        ...existing.provenance,
        makeProvenance(result.provenanceSource, params.taskId, params.sessionRef, now, observations >= 2 ? 're-observed' : 'unverified'),
      ],
    };
  }

  private profileFromCandidate(
    candidate: DesignCandidate,
    params: { taskId: string; sessionRef: string },
    now: string,
  ): StyleProfile {
    return {
      id: slugify(candidate.name) || candidate.id,
      candidate_id: candidate.id,
      name: candidate.name,
      mood: inferMood(candidate),
      source_urls: candidate.source_urls,
      tokens: candidate.tokens,
      component_patterns: candidate.component_patterns,
      anti_patterns: candidate.anti_patterns,
      created_at: now,
      updated_at: now,
      provenance: makeProvenance('user-confirmed', params.taskId, params.sessionRef, now, 'user-confirmed'),
    };
  }

  private async readCandidatesFile(): Promise<DesignCandidatesFile> {
    try {
      const raw = await readFile(this.candidatesPath, 'utf-8');
      return JSON.parse(raw) as DesignCandidatesFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return { candidates: [] };
      throw err;
    }
  }

  private async readCritiquesFile(): Promise<DesignCritiquesFile> {
    try {
      const raw = await readFile(this.critiquesPath, 'utf-8');
      return JSON.parse(raw) as DesignCritiquesFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return { critiques: [] };
      throw err;
    }
  }

  private async readProfileFile(path: string): Promise<StyleProfile | null> {
    try {
      return JSON.parse(await readFile(path, 'utf-8')) as StyleProfile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  private async getActiveFile(): Promise<DesignActiveProfileFile> {
    try {
      return JSON.parse(await readFile(this.activePath, 'utf-8')) as DesignActiveProfileFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') return { ...DEFAULT_ACTIVE_FILE };
      throw err;
    }
  }

  private async writeCandidates(candidates: DesignCandidate[]): Promise<void> {
    await mkdir(dirname(this.candidatesPath), { recursive: true });
    await writeFile(this.candidatesPath, JSON.stringify({ candidates }, null, 2), 'utf-8');
  }

  private async writeCritiques(critiques: DesignCritique[]): Promise<void> {
    await mkdir(dirname(this.critiquesPath), { recursive: true });
    await writeFile(this.critiquesPath, JSON.stringify({ critiques }, null, 2), 'utf-8');
  }

  private async writeProfile(profile: StyleProfile): Promise<void> {
    await mkdir(this.profilesDir, { recursive: true });
    await writeFile(this.profilePath(profile.id), JSON.stringify(profile, null, 2), 'utf-8');
  }

  private async writeActiveFile(active: DesignActiveProfileFile): Promise<void> {
    await mkdir(dirname(this.activePath), { recursive: true });
    await writeFile(this.activePath, JSON.stringify(active, null, 2), 'utf-8');
  }

  private profilePath(profileId: string): string {
    return join(this.profilesDir, `${profileId}.json`);
  }
}

function makeProvenance(
  sourceType: DesignProvenance['source_type'],
  taskId: string,
  sessionRef: string,
  createdAt: string,
  trustStatus: DesignProvenance['trust_status'],
): DesignProvenance {
  return {
    source_type: sourceType,
    task_id: taskId,
    session_ref: sessionRef,
    created_at: createdAt,
    trust_status: trustStatus,
  };
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function inferMood(candidate: DesignCandidate): string[] {
  const moods = new Set<string>();
  if (candidate.tokens.shadow.some((shadow) => shadow !== 'none')) moods.add('dimensional');
  if (candidate.tokens.colors.accent.length >= 3) moods.add('colorful');
  if (candidate.tokens.border.strong || candidate.tokens.border.default) moods.add('structured');
  return [...moods];
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
