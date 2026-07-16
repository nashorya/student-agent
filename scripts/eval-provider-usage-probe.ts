import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadEvalTask } from '../src/evals/task-loader.js';
import { createEvalSandbox } from '../src/evals/sandbox.js';
import { runStudentAgentEval } from '../src/evals/agent-runner.js';

interface CliOptions {
  taskDir: string;
  outputDir: string;
  keepSandbox: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const task = await loadEvalTask(resolve(options.taskDir));
  const sandbox = await createEvalSandbox(task);

  try {
    const trace = await runStudentAgentEval({
      task,
      sandboxDir: sandbox.path,
    });

    const calls = (trace.usageEvents ?? []).map((event) => ({
      callIndex: event.index,
      // Keep the Pi-normalized fields separate. Do not guess whether a provider's
      // input field includes or excludes cached tokens until raw payloads are checked.
      inputTokens: event.usage.inputTokens,
      outputTokens: event.usage.outputTokens,
      cacheReadTokens: event.usage.cacheReadTokens,
      cacheWriteTokens: event.usage.cacheWriteTokens,
      totalTokens: event.usage.totalTokens,
      costUsd: event.usage.costUsd,
    }));

    const result = {
      schemaVersion: 1,
      probe: 'provider-usage',
      taskId: task.id,
      sandboxDir: options.keepSandbox ? sandbox.path : undefined,
      model: trace.model,
      status: trace.status,
      errorMessage: trace.errorMessage,
      llmCallCount: calls.length,
      calls,
      aggregate: trace.tokenUsage,
      checks: {
        hasMultipleCalls: calls.length >= 3,
        hasInputUsage: calls.some((call) => call.inputTokens > 0),
        hasOutputUsage: calls.some((call) => call.outputTokens > 0),
        hasCacheDetails: calls.some(
          (call) => call.cacheReadTokens > 0 || call.cacheWriteTokens > 0,
        ),
      },
      note:
        'This probe validates Pi-normalized usage. Capture raw HTTP/SSE usage separately ' +
        'when validating provider-specific cached-token semantics.',
    };

    await mkdir(options.outputDir, { recursive: true });
    const outputPath = join(
      options.outputDir,
      `provider-usage-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: true, outputPath, result }, null, 2));
  } finally {
    if (!options.keepSandbox) {
      await sandbox.cleanup();
    }
  }
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    taskDir: 'evals/tasks/jspace-compaction-probe-01',
    outputDir: 'evals/results/probes',
    keepSandbox: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--task-dir' && args[index + 1]) {
      parsed.taskDir = args[++index];
      continue;
    }
    if (arg === '--output-dir' && args[index + 1]) {
      parsed.outputDir = args[++index];
      continue;
    }
    if (arg === '--keep-sandbox') {
      parsed.keepSandbox = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
