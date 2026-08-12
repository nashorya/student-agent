import { parseCommand } from '../cli/command-parser.js';

export type PasteBufferResult =
  | { type: 'submit'; source: 'input' | 'paste'; value: string }
  | { type: 'status'; text: string };

export interface PasteBuffer {
  handle: (value: string) => PasteBufferResult;
}

export function createPasteBuffer(): PasteBuffer {
  let lines: string[] | null = null;

  return {
    handle(value) {
      const oneShot = parseCommand(value);
      if (!lines && oneShot?.type === 'paste') {
        return { type: 'submit', source: 'paste', value: oneShot.content };
      }

      const trimmed = value.trim();
      const lower = trimmed.toLowerCase();

      if (!lines && /^\/paste(?:\s|$)/iu.test(trimmed)) {
        lines = [];
        const firstLine = value
          .replace(/^\/paste[ \t]*/iu, '')
          .replace(/^\r?\n/u, '')
          .trimEnd();
        if (firstLine) lines.push(firstLine);
        return pasteStatus(lines.length, true);
      }

      if (!lines) {
        return { type: 'submit', source: 'input', value };
      }

      if (lower === '/end') {
        const content = lines.join('\n');
        lines = null;
        if (!content.trim()) {
          return { type: 'status', text: '粘贴内容为空，未提交' };
        }
        return { type: 'submit', source: 'paste', value: content };
      }

      if (lower === '/cancel') {
        lines = null;
        return { type: 'status', text: '已取消粘贴' };
      }

      lines.push(value);
      return pasteStatus(lines.length, false);
    },
  };
}

function pasteStatus(lineCount: number, started: boolean): PasteBufferResult {
  if (started && lineCount === 0) {
    return { type: 'status', text: '粘贴模式：输入 /end 结束，/cancel 取消' };
  }
  return {
    type: 'status',
    text: `粘贴模式：已收集 ${lineCount} 行，输入 /end 结束`,
  };
}
