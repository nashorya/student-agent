import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ParsedReward {
  score: number;
  source: 'reward.txt' | 'reward.json';
}

export async function readReward(logsDir: string): Promise<ParsedReward | null> {
  const json = await readRewardJson(join(logsDir, 'reward.json'));
  if (json) return json;
  return readRewardTxt(join(logsDir, 'reward.txt'));
}

async function readRewardJson(path: string): Promise<ParsedReward | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as { score?: unknown; reward?: unknown };
    const value = parsed.score ?? parsed.reward;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { score: clamp01(value), source: 'reward.json' };
    }
    throw new Error(`${path} must contain numeric score or reward`);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function readRewardTxt(path: string): Promise<ParsedReward | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const value = Number.parseFloat(raw.trim());
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must contain a numeric score`);
    }
    return { score: clamp01(value), source: 'reward.txt' };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isMissing(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code?: unknown }).code === 'ENOENT'
  );
}
