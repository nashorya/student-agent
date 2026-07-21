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

  it('recovers SWE-bench identity from hints when the active task id is internal', () => {
    expect(resolveRepositoryIdentity({
      taskId: 'task_1784388855001',
      hints: [
        'Eval task: SWE-bench astropy__astropy-14995',
        'Instance: astropy__astropy-14995\n\nNDDataRef mask propagation fails',
      ],
      cwd: '/Users/dev/student-agent-injection-instrument',
    })).toBe('astropy/astropy');
  });

  it('does not invent a repository from bare task_* ids', () => {
    expect(resolveRepositoryIdentity({
      taskId: 'task_1784388855001',
      cwd: '/tmp/workspaces/owner/my-repo',
    })).toBe('owner/my-repo');
  });
});
