import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  buildTerminalBenchCommand,
  defaultExternalBenchmarkOutputDir,
} from '../src/evals/external-benchmarks.js';

interface CliOptions {
  command?: string;
  dataset: string;
  path?: string;
  agent?: string;
  agentImportPath?: string;
  model: string;
  nConcurrent?: number;
  agentSetupTimeoutMultiplier?: number;
  nTasks?: number;
  outputDir?: string;
  dryRun: boolean;
  extraArgs: string[];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const studentAgentEnv = shouldAutoForwardStudentAgentEnv(options)
    ? collectStudentAgentEnv(process.env, options)
    : {};
  let tempEnvDir: string | undefined;
  try {
    const envFile = options.dryRun || Object.keys(studentAgentEnv).length === 0
      ? undefined
      : await writeTempEnvFile(studentAgentEnv);
    if (envFile) {
      tempEnvDir = dirname(envFile);
    }
    const external = buildTerminalBenchCommand({
      command: options.command,
      dataset: options.dataset,
      path: options.path,
      agent: options.agent,
      agentImportPath: options.agentImportPath,
      model: options.model,
      nConcurrent: options.nConcurrent,
      agentSetupTimeoutMultiplier: options.agentSetupTimeoutMultiplier,
      nTasks: options.nTasks,
      outputDir: options.outputDir,
      envFile,
      extraArgs: options.extraArgs,
    });

    if (options.dryRun) {
      console.log(JSON.stringify({
        ok: true,
        benchmark: 'terminal-bench',
        command: external.command,
        args: external.args,
        autoEnvFileKeys: Object.keys(studentAgentEnv),
      }, null, 2));
      return;
    }

    const exitCode = await runProcess(external.command, external.args);
    process.exitCode = exitCode;
  } finally {
    if (tempEnvDir) {
      await rm(tempEnvDir, { recursive: true, force: true });
    }
  }
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    dataset: process.env.TERMINAL_BENCH_DATASET ?? 'terminal-bench@2.0',
    path: process.env.TERMINAL_BENCH_PATH,
    agent: process.env.TERMINAL_BENCH_AGENT ?? 'claude-code',
    agentImportPath: process.env.TERMINAL_BENCH_AGENT_IMPORT_PATH,
    model: process.env.TERMINAL_BENCH_MODEL ?? 'anthropic/claude-opus-4-1',
    nConcurrent: process.env.TERMINAL_BENCH_N_CONCURRENT
      ? Number.parseInt(process.env.TERMINAL_BENCH_N_CONCURRENT, 10)
      : 1,
    nTasks: process.env.TERMINAL_BENCH_N_TASKS
      ? Number.parseInt(process.env.TERMINAL_BENCH_N_TASKS, 10)
      : 1,
    outputDir: process.env.TERMINAL_BENCH_OUTPUT_DIR ?? defaultExternalBenchmarkOutputDir('terminal-bench'),
    dryRun: false,
    extraArgs: [],
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--command' && args[index + 1]) {
      parsed.command = args[++index];
      continue;
    }
    if (arg === '--dataset' && args[index + 1]) {
      parsed.dataset = args[++index];
      continue;
    }
    if (arg === '--path' && args[index + 1]) {
      parsed.path = args[++index];
      continue;
    }
    if (arg === '--agent' && args[index + 1]) {
      parsed.agent = args[++index];
      continue;
    }
    if (arg === '--agent-import-path' && args[index + 1]) {
      parsed.agentImportPath = args[++index];
      continue;
    }
    if (arg === '--model' && args[index + 1]) {
      parsed.model = args[++index];
      continue;
    }
    if (arg === '--n-concurrent' && args[index + 1]) {
      parsed.nConcurrent = Number.parseInt(args[++index], 10);
      continue;
    }
    if (arg === '--agent-setup-timeout-multiplier' && args[index + 1]) {
      parsed.agentSetupTimeoutMultiplier = Number.parseFloat(args[++index]);
      continue;
    }
    if (arg === '--n-tasks' && args[index + 1]) {
      parsed.nTasks = Number.parseInt(args[++index], 10);
      continue;
    }
    if (arg === '--output-dir' && args[index + 1]) {
      parsed.outputDir = args[++index];
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--') {
      parsed.extraArgs.push(...args.slice(index + 1));
      break;
    }
    throw new Error(`Unknown eval-terminal-bench argument: ${arg}`);
  }
  if (parsed.nConcurrent !== undefined && (!Number.isInteger(parsed.nConcurrent) || parsed.nConcurrent <= 0)) {
    throw new Error('--n-concurrent must be a positive integer');
  }
  if (
    parsed.agentSetupTimeoutMultiplier !== undefined
    && (!Number.isFinite(parsed.agentSetupTimeoutMultiplier) || parsed.agentSetupTimeoutMultiplier <= 0)
  ) {
    throw new Error('--agent-setup-timeout-multiplier must be a positive number');
  }
  if (parsed.nTasks !== undefined && (!Number.isInteger(parsed.nTasks) || parsed.nTasks <= 0)) {
    throw new Error('--n-tasks must be a positive integer');
  }
  return parsed;
}

function runProcess(command: string, args: string[]): Promise<number> {
  return new Promise((resolveProcess) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      resolveProcess(1);
    });
    child.on('close', (code, signal) => {
      resolveProcess(signal ? 124 : code ?? 1);
    });
  });
}

const STUDENT_AGENT_ENV_KEYS = [
  'STUDENT_AGENT_PROVIDER',
  'STUDENT_AGENT_API',
  'STUDENT_AGENT_BASE_URL',
  'STUDENT_AGENT_MODEL',
  'STUDENT_AGENT_EXECUTION_MODE',
  'STUDENT_AGENT_SUPPRESS_EMBEDDING_REMINDER',
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'STUDENT_AGENT_FEATURE_CONTEXT7',
  'CONTEXT7_API_KEY',
  'CONTEXT7_TIMEOUT_MS',
  'CONTEXT7_MAX_DOCS_CHARS',
  'STUDENT_AGENT_HARBOR_SECRET_ENV_FILE',
] as const;

function shouldAutoForwardStudentAgentEnv(options: CliOptions): boolean {
  return Boolean(options.agentImportPath?.includes('student_agent'));
}

function collectStudentAgentEnv(env: NodeJS.ProcessEnv, options: CliOptions): Record<string, string> {
  const collected: Record<string, string> = defaultStudentAgentEnv(options);
  for (const key of STUDENT_AGENT_ENV_KEYS) {
    const value = env[key];
    if (value) {
      collected[key] = value;
    }
  }
  return collected;
}

function defaultStudentAgentEnv(options: CliOptions): Record<string, string> {
  const model = options.model.trim();
  if (model.startsWith('deepseek')) {
    return {
      STUDENT_AGENT_PROVIDER: 'deepseek',
      STUDENT_AGENT_API: 'openai-completions',
      STUDENT_AGENT_BASE_URL: 'https://api.deepseek.com',
      STUDENT_AGENT_MODEL: model,
      STUDENT_AGENT_EXECUTION_MODE: 'yolo',
      STUDENT_AGENT_SUPPRESS_EMBEDDING_REMINDER: '1',
    };
  }
  return {
    STUDENT_AGENT_MODEL: model,
    STUDENT_AGENT_EXECUTION_MODE: 'yolo',
    STUDENT_AGENT_SUPPRESS_EMBEDDING_REMINDER: '1',
  };
}

async function writeTempEnvFile(values: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'student-agent-harbor-env-'));
  const path = join(dir, 'agent.env');
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${quoteDotenvValue(value)}`)
    .join('\n');
  await writeFile(path, `${body}\n`, { mode: 0o600 });
  return path;
}

function quoteDotenvValue(value: string): string {
  return JSON.stringify(value);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
