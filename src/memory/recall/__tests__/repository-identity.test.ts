import { describe, expect, it } from 'vitest';
import { normalizeRepositoryIdentity, resolveRepositoryIdentity } from '../repository-identity.js';

describe('repository identity', () => {
  it('normalizes git remotes and filesystem paths to stable owner/repo slugs', () => {
    expect(normalizeRepositoryIdentity('git@github.com:astropy/astropy.git')).toBe('astropy/astropy');
    expect(normalizeRepositoryIdentity('/workspaces/owner/my-repo')).toBe('owner/my-repo');
  });

  it('derives SWE-bench repository identity without shell work', () => {
    expect(resolveRepositoryIdentity({ taskId: 'astropy__astropy-12907' })).toBe('astropy/astropy');
    expect(resolveRepositoryIdentity({ taskId: 'scikit-learn__scikit-learn-1234' })).toBe('scikit-learn/scikit-learn');
  });
});
