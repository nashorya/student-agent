export function resolveRepositoryIdentity(input: {
  repository?: string;
  taskId?: string;
  cwd?: string;
}): string {
  if (input.repository) return normalizeRepositoryIdentity(input.repository);
  const sweBench = input.taskId?.match(/^(.+?)__(.+)-\d+$/);
  if (sweBench) return normalizeRepositoryIdentity(`${sweBench[1]}/${sweBench[2]}`);
  return normalizeRepositoryIdentity(input.cwd ?? process.cwd());
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
