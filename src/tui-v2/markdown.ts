import { renderMarkdown } from '../cli/markdown.js';
import { stripAnsi, visibleLength } from './terminal-control.js';

export interface RenderMarkdownLinesOptions {
  width: number;
  streaming: boolean;
}

export function renderMarkdownLines(
  text: string,
  options: RenderMarkdownLinesOptions,
): string[] {
  const width = Math.max(1, options.width || 80);
  const normalized = normalizeMarkdown(text, options.streaming);
  const rendered = renderMarkdown(normalized, width);
  if (!rendered) return [''];

  return rendered
    .split(/\r?\n/u)
    .flatMap((line) => wrapLine(stripAnsi(line), width));
}

function normalizeMarkdown(text: string, streaming: boolean): string {
  const menuSafe = text.replace(/^(\s*\d+)\)/gmu, '$1\\)');
  if (!streaming) return menuSafe;

  const fenceCount = (menuSafe.match(/^```/gmu) ?? []).length;
  return fenceCount % 2 === 1 ? `${menuSafe}\n\`\`\`` : menuSafe;
}

function wrapLine(line: string, width: number): string[] {
  if (visibleLength(line) <= width) return [line];

  const lines: string[] = [];
  let current = '';

  for (const ch of Array.from(line)) {
    if (current && visibleLength(current + ch) > width) {
      lines.push(current);
      current = ch;
      continue;
    }
    current += ch;
  }

  if (current) lines.push(current);
  return lines;
}
