const SWE_BENCH_INSTANCE_RE = /\b([A-Za-z0-9_.-]+)__([A-Za-z0-9_.-]+)-\d+\b/;

export function resolveRepositoryIdentity(input: {
  repository?: string;
  taskId?: string;
  cwd?: string;
  hints?: Array<string | undefined | null>;
}): string {
  if (input.repository) return normalizeRepositoryIdentity(input.repository);
  const fromTaskId = repositoryFromSweBenchInstanceId(input.taskId);
  if (fromTaskId) return fromTaskId;
  for (const hint of input.hints ?? []) {
    const fromHint = repositoryFromSweBenchInstanceId(hint);
    if (fromHint) return fromHint;
  }
  return normalizeRepositoryIdentity(input.cwd ?? process.cwd());
}

export function repositoryFromSweBenchInstanceId(value?: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(SWE_BENCH_INSTANCE_RE);
  if (!match) return null;
  return normalizeRepositoryIdentity(`${match[1]}/${match[2]}`);
}

export function normalizeRepositoryIdentity(value: string): string {
  const normalized = value.trim().toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\.git$/i, '')
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/^git@[^:]+:/, '')
    .replace(/^\/+|\/+$/g, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.slice(-2).join('/').replace(/[^a-z0-9._/-]+/g, '-');
}
