export type ProjectKbTrustStatus = 'cached' | 'stale' | 'untrusted';

export interface ProjectKbEntry {
  id: string;
  source_url: string;
  title: string;
  content: string;
  retrieved_at: string;
  version_hint?: string;
  ttl_days: number;
  trust_status: ProjectKbTrustStatus;
}

export interface ProjectKbFile {
  entries: ProjectKbEntry[];
}
