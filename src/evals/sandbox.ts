import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import type { EvalTaskDefinition, FileSnapshot, VerifierResult } from './types.js';
import { readReward } from './reward.js';

const SNAPSHOT_EXCLUDES = new Set(['.git', 'node_modules', 'logs', 'memory', '.student-agent-eval', '.pi']);

export interface EvalSandbox {
  path: string;
  logsDir: string;
  cleanup: () => Promise<void>;
}

export async function createEvalSandbox(task: EvalTaskDefinition, tempRoot = tmpdir()): Promise<EvalSandbox> {
  const sandboxDir = await mkdtemp(join(tempRoot, `student-agent-eval-${task.id}-`));
  const logsDir = join(sandboxDir, 'logs/verifier');
  await cp(task.environmentDir, sandboxDir, { recursive: true, force: true });
  await mkdir(logsDir, { recursive: true });
  return {
    path: sandboxDir,
    logsDir,
    cleanup: () => rm(sandboxDir, { recursive: true, force: true }),
  };
}

export async function runVerifier(task: EvalTaskDefinition, sandbox: EvalSandbox): Promise<VerifierResult> {
  const started = Date.now();
  const result = await runShellScript(task.testScriptPath, sandbox.path, sandbox.logsDir, task.timeoutSeconds);
  const reward = await readReward(sandbox.logsDir);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: Date.now() - started,
    correctnessScore: reward?.score ?? (result.exitCode === 0 ? 1 : 0),
    rewardSource: reward?.source ?? 'exit_code',
  };
}

export async function runSolution(task: EvalTaskDefinition, sandbox: EvalSandbox): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!task.solutionScriptPath) {
    throw new Error(`Task ${task.id} does not provide solution/solve.sh`);
  }
  return runShellScript(task.solutionScriptPath, sandbox.path, sandbox.logsDir, task.timeoutSeconds);
}

export async function snapshotFiles(root: string): Promise<FileSnapshot> {
  const files: FileSnapshot['files'] = [];
  await collectFiles(root, root, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files };
}

export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): string[] {
  const beforeMap = new Map(before.files.map((file) => [file.path, file.hash]));
  const changed: string[] = [];
  for (const file of after.files) {
    if (beforeMap.get(file.path) !== file.hash) {
      changed.push(file.path);
    }
    beforeMap.delete(file.path);
  }
  for (const deletedPath of beforeMap.keys()) {
    changed.push(deletedPath);
  }
  return changed.sort();
}

async function collectFiles(root: string, dir: string, files: FileSnapshot['files']): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SNAPSHOT_EXCLUDES.has(entry.name)) continue;
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    if (entry.isDirectory()) {
      await collectFiles(root, path, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const [content, info] = await Promise.all([readFile(path), stat(path)]);
    files.push({
      path: rel,
      hash: createHash('sha256').update(content).digest('hex'),
      size: info.size,
    });
  }
}

function runShellScript(scriptPath: string, cwd: string, logsDir: string, timeoutSeconds: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('bash', [scriptPath], {
      cwd,
      env: {
        ...process.env,
        SANDBOX_DIR: cwd,
        LOGS_DIR: logsDir,
        REWARD_FILE: join(logsDir, 'reward.txt'),
        REWARD_JSON_FILE: join(logsDir, 'reward.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutSeconds * 1000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode: signal ? 124 : code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
