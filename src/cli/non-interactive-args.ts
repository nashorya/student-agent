export type NonInteractiveArgs =
  | { mode: 'interactive' }
  | {
    mode: 'prompt';
    prompt: string;
    jsonSummaryPath?: string;
    runMode?: 'interactive' | 'eval';
    memoryDir?: string;
  }
  | {
    mode: 'prompt-file';
    promptFile: string;
    jsonSummaryPath?: string;
    runMode?: 'interactive' | 'eval';
    memoryDir?: string;
  }
  | { mode: 'error'; message: string };

export function parseNonInteractiveArgs(args: string[]): NonInteractiveArgs {
  if (args.length === 0) {
    return { mode: 'interactive' };
  }

  let prompt: string | undefined;
  let promptFile: string | undefined;
  let jsonSummaryPath: string | undefined;
  let runMode: 'interactive' | 'eval' | undefined;
  let memoryDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--prompt') {
      const value = args[index + 1];
      if (!value) {
        return { mode: 'error', message: '--prompt requires a value' };
      }
      prompt = value;
      index += 1;
      continue;
    }

    if (arg === '--prompt-file') {
      const value = args[index + 1];
      if (!value) {
        return { mode: 'error', message: '--prompt-file requires a path' };
      }
      promptFile = value;
      index += 1;
      continue;
    }

    if (arg === '--json-summary') {
      const value = args[index + 1];
      if (!value) {
        return { mode: 'error', message: '--json-summary requires a path' };
      }
      jsonSummaryPath = value;
      index += 1;
      continue;
    }

    if (arg === '--run-mode') {
      const value = args[index + 1];
      if (!value) {
        return { mode: 'error', message: '--run-mode requires a value' };
      }
      if (value !== 'interactive' && value !== 'eval') {
        return { mode: 'error', message: '--run-mode must be interactive or eval' };
      }
      runMode = value;
      index += 1;
      continue;
    }

    if (arg === '--memory-dir') {
      const value = args[index + 1];
      if (!value) {
        return { mode: 'error', message: '--memory-dir requires a path' };
      }
      memoryDir = value;
      index += 1;
      continue;
    }

    return { mode: 'error', message: `Unknown argument: ${arg}` };
  }

  if (prompt !== undefined && promptFile !== undefined) {
    return { mode: 'error', message: 'Use either --prompt or --prompt-file, not both' };
  }

  if (jsonSummaryPath !== undefined && prompt === undefined && promptFile === undefined) {
    return { mode: 'error', message: '--json-summary requires --prompt or --prompt-file' };
  }
  if (runMode !== undefined && prompt === undefined && promptFile === undefined) {
    return { mode: 'error', message: '--run-mode requires --prompt or --prompt-file' };
  }
  if (memoryDir !== undefined && prompt === undefined && promptFile === undefined) {
    return { mode: 'error', message: '--memory-dir requires --prompt or --prompt-file' };
  }

  if (prompt !== undefined) {
    return {
      mode: 'prompt',
      prompt,
      ...(jsonSummaryPath ? { jsonSummaryPath } : {}),
      ...(runMode ? { runMode } : {}),
      ...(memoryDir ? { memoryDir } : {}),
    };
  }

  if (promptFile !== undefined) {
    return {
      mode: 'prompt-file',
      promptFile,
      ...(jsonSummaryPath ? { jsonSummaryPath } : {}),
      ...(runMode ? { runMode } : {}),
      ...(memoryDir ? { memoryDir } : {}),
    };
  }

  return { mode: 'interactive' };
}
