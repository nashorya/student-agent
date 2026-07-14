import type { ArchiveAdr, ArchiveBug, ArchivePaths, ArchiveProject, ArchiveTimelineEntry } from '../types.js';

export interface ArchiveAdapter {
  readonly kind: 'canonical' | 'conventional' | 'read_only';
  readonly canWrite: boolean;
  read(root: string, paths: ArchivePaths): Promise<ArchiveProject>;
  serializeAdr?(adr: ArchiveAdr, previous?: string): string;
  serializeBuglog?(bugs: ArchiveBug[], previous?: string): string;
  serializeIndex?(timeline: ArchiveTimelineEntry[], previous?: string): string;
}
