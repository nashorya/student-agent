import { KnacksManager } from '../memory/knacks/index.js';
import { PreferencesManager } from '../memory/preferences/manager.js';
import { readRecentSignals } from '../memory/signals/signal-store.js';
import type { Signal } from '../memory/signals/types.js';

export function formatSignalActivity(signal: Signal): string {
  const hint = signal.recoveryHint ? ` · ${signal.recoveryHint}` : '';
  return `${signal.kind} [${signal.severity}] ${signal.summary}${hint}`;
}

export function formatReflectActivity(summary: {
  patternsExtracted: number;
  promotedCount: number;
  knacksPromoted?: number;
}): string {
  const knackPart = summary.knacksPromoted
    ? `，升级 ${summary.knacksPromoted} 个 knack`
    : '';
  return `提取 ${summary.patternsExtracted} 个模式，升级 ${summary.promotedCount} 条偏好${knackPart}`;
}

export function formatRecallActivity(items: Array<{ kind?: string; summary?: string }>): string {
  if (items.length === 0) return 'no recall items';
  const byKind = new Map<string, number>();
  for (const item of items) {
    const kind = item.kind ?? 'item';
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const counts = [...byKind.entries()]
    .map(([kind, count]) => `${kind}:${count}`)
    .join(' · ');
  const sample = items
    .slice(0, 3)
    .map((item) => item.summary?.trim() || item.kind || 'item')
    .join('; ');
  return `${items.length} injected (${counts}) — ${sample}`;
}

export async function buildMemoryOverlaySnapshot(memoryDir: string): Promise<string> {
  const signals = await readRecentSignals(5, memoryDir);
  const [knacks, prefs] = await Promise.all([
    KnacksManager.getInstance(memoryDir).getPromptInjectableKnacks(),
    PreferencesManager.getInstance(memoryDir).getAll(),
  ]);

  const lines = [
    `knacks: ${knacks.length} · preferences: ${prefs.length}`,
    signals.length === 0
      ? 'signals: (none recent)'
      : [
        'signals:',
        ...signals.slice().reverse().map((signal) => {
          const mark = signal.severity === 'high' ? '!' : signal.severity === 'medium' ? '*' : '·';
          return `  ${mark} ${signal.kind}: ${truncate(signal.summary, 72)}`;
        }),
      ].join('\n'),
  ];
  return lines.join('\n');
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
