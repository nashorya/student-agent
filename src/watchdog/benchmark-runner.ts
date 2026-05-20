import { readFile, writeFile, mkdir, mkdtemp, rm, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { WriteQueue } from '../core/write-queue.js';
import { getProjectMemoryDir } from '../core/paths.js';

export interface BenchmarkTask {
  id: string;
  description: string;
  referenceOutput: string;
}

export interface BenchmarkResult {
  task_id: string;
  score: number;
  tool_signature: string[];
  created_at: string;
}

export interface BenchmarkResultsFile {
  results: BenchmarkResult[];
}

export interface BenchmarkExecutor {
  run(task: BenchmarkTask): Promise<{ output: string; toolSignature: string[] }>;
}

export interface SandboxBenchmarkExecutorOptions {
  fixtureDir: string;
  tempRoot?: string;
  executorFactory: (sandboxDir: string) => BenchmarkExecutor;
}

export class SandboxBenchmarkExecutor implements BenchmarkExecutor {
  constructor(private readonly options: SandboxBenchmarkExecutorOptions) {}

  async run(task: BenchmarkTask): Promise<{ output: string; toolSignature: string[] }> {
    const sandboxDir = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), `student-agent-benchmark-${task.id}-`));
    try {
      await cp(this.options.fixtureDir, sandboxDir, { recursive: true, force: true });
      return await this.options.executorFactory(sandboxDir).run(task);
    } finally {
      await rm(sandboxDir, { recursive: true, force: true });
    }
  }
}

export class BenchmarkResultsManager {
  private static instance: BenchmarkResultsManager | null = null;
  private readonly filePath: string;

  private constructor(memoryDir: string) {
    this.filePath = join(memoryDir, 'benchmark-results', 'results.json');
  }

  static getInstance(memoryDir?: string): BenchmarkResultsManager {
    const dir = memoryDir ?? getProjectMemoryDir();
    if (!BenchmarkResultsManager.instance) {
      BenchmarkResultsManager.instance = new BenchmarkResultsManager(dir);
    }
    return BenchmarkResultsManager.instance;
  }

  static resetInstance(): void {
    BenchmarkResultsManager.instance = null;
  }

  async getAll(): Promise<BenchmarkResult[]> {
    const file = await this.readFile();
    return file?.results ?? [];
  }

  async appendMany(results: BenchmarkResult[]): Promise<void> {
    await WriteQueue.getInstance().enqueue(async () => {
      const file = await this.readFile();
      const merged = file ? [...file.results, ...results] : results;
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify({ results: merged }, null, 2), 'utf-8');
    });
  }

  private async readFile(): Promise<BenchmarkResultsFile | null> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as BenchmarkResultsFile;
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }
}

export class BenchmarkRunner {
  constructor(
    private readonly executor: BenchmarkExecutor,
    private readonly resultsManager: BenchmarkResultsManager,
    private readonly tasks: BenchmarkTask[] = DEFAULT_BENCHMARK_TASKS,
  ) {}

  async runAll(): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    for (const task of this.tasks) {
      const output = await this.executor.run(task);
      results.push({
        task_id: task.id,
        score: scoreTextSimilarity(output.output, task.referenceOutput),
        tool_signature: output.toolSignature,
        created_at: new Date().toISOString(),
      });
    }

    await this.resultsManager.appendMany(results);
    return results;
  }
}

export const DEFAULT_BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: 'bench_typescript_types',
    description: '给函数添加 TypeScript 类型标注',
    referenceOutput: 'typed function signature',
  },
  {
    id: 'bench_fix_bug',
    description: '根据 bug 描述修复局部代码',
    referenceOutput: 'bug fixed with regression check',
  },
  {
    id: 'bench_refactor_small_functions',
    description: '将模块重构为更小的函数',
    referenceOutput: 'small focused functions',
  },
];

export function scoreTextSimilarity(actual: string, expected: string): number {
  const actualTokens = tokenize(actual);
  const expectedTokens = tokenize(expected);
  if (actualTokens.size === 0 || expectedTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of actualTokens) {
    if (expectedTokens.has(token)) {
      intersection++;
    }
  }

  const union = new Set([...actualTokens, ...expectedTokens]).size;
  return Number((intersection / union).toFixed(4));
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_\u4e00-\u9fff]+/u)
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
