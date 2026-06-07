import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface CliOptions {
  drafts: string[];
  allDrafts: boolean;
  taskIds: string[];
  abaDir: string;
  tmpDir: string;
  timeout: number;
  force: boolean;
  skipBenchmark: boolean;
  skipCollect: boolean;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const drafts = resolveDrafts(options);
  const abaBin = join(options.abaDir, '.venv', 'bin', 'bench-audit');
  if (!existsSync(abaBin)) {
    throw new Error(`ABA bench-audit not found: ${abaBin}`);
  }

  const dataDir = join(options.tmpDir, 'drafts');
  const auditRunDir = join(options.tmpDir, 'audit-runs');
  const benchmarkReposDir = join(options.tmpDir, 'benchmark-repos');
  const configPath = join(options.tmpDir, 'student-agent-eval-drafts.yaml');

  prepareDraftCopy(drafts, dataDir);
  mkdirSync(auditRunDir, { recursive: true });
  mkdirSync(benchmarkReposDir, { recursive: true });
  writeFileSync(configPath, renderAbaConfig(dataDir));

  const env = {
    ...process.env,
    PATH: `/Applications/Codex.app/Contents/Resources:${process.env.HOME}/.local/bin:${process.env.PATH ?? ''}`,
    BENCHMARK_REPOS_DIR: benchmarkReposDir,
    AUDIT_RUN_DIR: auditRunDir,
  };

  if (!options.skipBenchmark) {
    run(abaBin, ['audit-benchmark', '--config', configPath, ...(options.force ? ['--force'] : [])], env, options.abaDir);
  }
  if (!options.skipCollect) {
    run(abaBin, ['collect-evidence', '--config', configPath, ...(options.force ? ['--force'] : [])], env, options.abaDir);
  }

  const taskArgs = options.taskIds.length > 0 ? options.taskIds : drafts;
  run(
    abaBin,
    [
      'audit-tasks',
      '--config',
      configPath,
      '--mode',
      'static',
      '--tasks',
      ...taskArgs,
      '--timeout',
      String(options.timeout),
      ...(options.force ? ['--force'] : []),
    ],
    env,
    options.abaDir,
  );

  console.log(JSON.stringify({
    ok: true,
    drafts,
    config_path: configPath,
    output_root: join(auditRunDir, 'neurips', 'student_agent_eval_drafts__student-agent-eval-drafts__actual'),
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    drafts: [],
    allDrafts: false,
    taskIds: [],
    abaDir: process.env.ABA_REPO_DIR ?? '/private/tmp/auto-bench-audit',
    tmpDir: '/private/tmp/student-agent-aba',
    timeout: 900,
    force: false,
    skipBenchmark: false,
    skipCollect: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--draft' && args[index + 1]) {
      parsed.drafts.push(args[++index]);
      continue;
    }
    if (arg === '--task' && args[index + 1]) {
      parsed.taskIds.push(args[++index]);
      continue;
    }
    if (arg === '--all-drafts') {
      parsed.allDrafts = true;
      continue;
    }
    if (arg === '--aba-dir' && args[index + 1]) {
      parsed.abaDir = resolve(args[++index]);
      continue;
    }
    if (arg === '--tmp-dir' && args[index + 1]) {
      parsed.tmpDir = resolve(args[++index]);
      continue;
    }
    if (arg === '--timeout' && args[index + 1]) {
      parsed.timeout = Number.parseInt(args[++index], 10);
      continue;
    }
    if (arg === '--force') {
      parsed.force = true;
      continue;
    }
    if (arg === '--skip-benchmark') {
      parsed.skipBenchmark = true;
      continue;
    }
    if (arg === '--skip-collect') {
      parsed.skipCollect = true;
      continue;
    }
    throw new Error(`Unknown eval:audit argument: ${arg}`);
  }

  if (parsed.allDrafts && parsed.drafts.length > 0) {
    throw new Error('Use either --all-drafts or one or more --draft values, not both');
  }
  if (!parsed.allDrafts && parsed.drafts.length === 0) {
    throw new Error('Provide --draft <eval-id> or --all-drafts');
  }
  if (!Number.isInteger(parsed.timeout) || parsed.timeout <= 0) {
    throw new Error('--timeout must be a positive integer');
  }
  return parsed;
}

function resolveDrafts(options: CliOptions): string[] {
  const draftsRoot = join(repoRoot, 'evals', 'drafts');
  const drafts = options.allDrafts
    ? readdirSync(draftsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : options.drafts;

  for (const draft of drafts) {
    const draftPath = join(draftsRoot, draft);
    if (!existsSync(draftPath)) {
      throw new Error(`Draft eval not found: ${draftPath}`);
    }
  }
  return [...new Set(drafts)].sort();
}

function prepareDraftCopy(drafts: string[], dataDir: string): void {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });

  for (const draft of drafts) {
    cpSync(join(repoRoot, 'evals', 'drafts', draft), join(dataDir, draft), { recursive: true });
  }
}

function renderAbaConfig(dataDir: string): string {
  return [
    'benchmark_name: student_agent_eval_drafts',
    'benchmark_type: neurips',
    'agent_cli: codex',
    'output_subdir: student-agent-eval-drafts',
    '',
    'code_url: https://github.com/nashorya/student-agent',
    `benchmark_data_dir: ${dataDir}`,
    `benchmark_repo_dir: ${repoRoot}`,
    `paper_path: ${join(repoRoot, 'docs', 'eval-writing-guide.md')}`,
    '',
    'domain_categories:',
    '  - code_swe',
    '  - agent_harness',
    '  - eval_authoring',
    '',
  ].join('\n');
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): void {
  console.log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

function printHelp(): void {
  console.log(`Usage:
  npm run eval:audit -- --draft <eval-id> [--draft <eval-id> ...]
  npm run eval:audit -- --all-drafts

Options:
  --task <eval-id>       Audit specific collected task ids. Defaults to selected drafts.
  --aba-dir <path>       ABA checkout. Defaults to ABA_REPO_DIR or /private/tmp/auto-bench-audit.
  --tmp-dir <path>       Working dir. Defaults to /private/tmp/student-agent-aba.
  --timeout <seconds>    Per-task ABA timeout. Defaults to 900.
  --force                Re-run ABA phases even when cached outputs exist.
  --skip-benchmark       Skip ABA benchmark-level audit.
  --skip-collect         Skip ABA evidence collection.
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
