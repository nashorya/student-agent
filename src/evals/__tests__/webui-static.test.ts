import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('eval webui static assets', () => {
  const rootDir = process.cwd();

  it('serves a static dashboard shell wired to the latest report JSON', async () => {
    const index = await readFile(join(rootDir, 'evals', 'webui', 'index.html'), 'utf-8');
    const app = await readFile(join(rootDir, 'evals', 'webui', 'app.js'), 'utf-8');

    expect(index).toContain('Eval 可视化面板');
    expect(index).toContain('app.js');
    expect(app).toContain('../results/latest/eval-report.json');
    expect(app).toContain('renderCatalog');
    expect(app).toContain('renderResults');
  });
});
