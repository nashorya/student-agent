import { readFile } from 'node:fs/promises';

export async function readEventsJsonl(path: string): Promise<unknown[]> {
  const raw = await readFile(path, 'utf-8');
  return raw.split(/\r?\n/u).flatMap((line, index) => {
    if (line.trim() === '') return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid JSONL at line ${index + 1}: ${message}`);
    }
  });
}
