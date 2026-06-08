import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getProjectMemoryDir } from '../../core/paths.js';
import type { Signal } from './types.js';

export function getSignalsPath(memoryDir?: string): string {
  const dir = memoryDir ?? getProjectMemoryDir();
  return join(dir, 'signals.jsonl');
}

export async function appendSignal(signal: Signal, memoryDir?: string): Promise<void> {
  const filePath = getSignalsPath(memoryDir);
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, JSON.stringify(signal) + '\n', 'utf-8');
}

export async function readRecentSignals(limit: number, memoryDir?: string): Promise<Signal[]> {
  if (limit <= 0) return [];
  try {
    const raw = await readFile(getSignalsPath(memoryDir), 'utf-8');
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);
    return lines.slice(-limit).flatMap((line) => {
      try {
        return [JSON.parse(line) as Signal];
      } catch {
        return [];
      }
    });
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    throw err;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
