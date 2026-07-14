import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArchiveConfig, ArchivePaths } from './types.js';

const ADR_DIR_CANDIDATES = ['docs/adr', 'docs/decisions', 'docs/architecture/decisions'];
const BUGLOG_CANDIDATES = ['docs/buglog.md', 'docs/bugs.md', 'BUGS.md'];
const INDEX_CANDIDATES = ['docs/INDEX.md', 'docs/agent/INDEX.md', 'CHANGELOG.md'];

export interface ArchiveDiscoveryResult {
  paths: ArchivePaths;
  writeMode: 'read_write' | 'read_only' | 'blocked';
  conflicts: string[];
  initializationRequired: boolean;
}

export function defaultArchiveConfig(): ArchiveConfig {
  return { enabled: true, format: 'auto', dashboardPath: 'docs/agent/dashboard.html' };
}

export async function discoverArchive(root: string, config: ArchiveConfig): Promise<ArchiveDiscoveryResult> {
  const adrMatches = config.adrDir ? [] : await existing(root, ADR_DIR_CANDIDATES);
  const bugMatches = config.buglogPath ? [] : await existing(root, BUGLOG_CANDIDATES);
  const indexMatches = config.indexPath ? [] : await existing(root, INDEX_CANDIDATES);
  const conflicts: string[] = [];
  if (adrMatches.length > 1) conflicts.push('multiple_adr_directories');
  if (bugMatches.length > 1) conflicts.push('multiple_buglogs');
  if (indexMatches.length > 1) conflicts.push('multiple_indexes');

  const paths: ArchivePaths = {
    indexPath: config.indexPath ?? indexMatches[0] ?? INDEX_CANDIDATES[0],
    buglogPath: config.buglogPath ?? bugMatches[0] ?? BUGLOG_CANDIDATES[0],
    adrDir: config.adrDir ?? adrMatches[0] ?? ADR_DIR_CANDIDATES[0],
    dashboardPath: config.dashboardPath ?? 'docs/agent/dashboard.html',
  };
  const explicitlyConfigured = Boolean(config.indexPath || config.buglogPath || config.adrDir);
  const anyExisting = explicitlyConfigured || adrMatches.length > 0 || bugMatches.length > 0 || indexMatches.length > 0;

  return {
    paths,
    writeMode: conflicts.length > 0 ? 'blocked' : anyExisting ? 'read_write' : 'read_only',
    conflicts,
    initializationRequired: !anyExisting,
  };
}

async function existing(root: string, candidates: string[]): Promise<string[]> {
  const checks = await Promise.all(candidates.map(async (candidate) => {
    try {
      await access(join(root, candidate));
      return candidate;
    } catch {
      return undefined;
    }
  }));
  return checks.filter((value): value is string => value !== undefined);
}
