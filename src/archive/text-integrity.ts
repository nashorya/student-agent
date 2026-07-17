import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const decoder = new TextDecoder('utf-8', { fatal: true });

export async function readArchiveText(path: string): Promise<{ text: string; sha256: string }> {
  const bytes = await readFile(path);
  if (bytes.includes(0)) {
    throw new Error(`Archive source contains NUL bytes: ${path}`);
  }

  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new Error(`Archive source is not valid UTF-8: ${path}`);
  }

  return {
    text,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
