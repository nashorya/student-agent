/**
 * 终端 Markdown 渲染器。
 *
 * 参照 Pi 的 packages/tui/src/components/markdown.ts，
 * 用 marked tokenizer + chalk 做 ANSI 终端输出。
 * 不依赖 TUI Component 接口，直接返回字符串。
 */

import { Marked, type Token, type Tokens } from 'marked';
import chalk from 'chalk';
import stringWidth from 'string-width';

const parser = new Marked();

/**
 * 将 Markdown 文本渲染为带 ANSI 样式的终端字符串。
 */
export function renderMarkdown(text: string, width?: number): string {
  if (!text || !text.trim()) return '';

  const contentWidth = width ?? process.stdout.columns ?? 80;
  const tokens = parser.lexer(preprocessMarkdown(text).replace(/\t/g, '   '));
  const lines: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextType = tokens[i + 1]?.type;
    lines.push(...renderToken(token, nextType, contentWidth));
  }

  return lines.join('\n');
}

function renderToken(token: Token, nextType?: string, contentWidth = process.stdout.columns || 80): string[] {
  const lines: string[] = [];

  switch (token.type) {
    case 'heading': {
      const text = renderInline(token.tokens ?? []);
      if (token.depth === 1) {
        lines.push(chalk.bold.underline(text));
      } else if (token.depth === 2) {
        lines.push(chalk.bold(text));
      } else {
        lines.push(chalk.bold(`${'#'.repeat(token.depth)} ${text}`));
      }
      if (nextType && nextType !== 'space') lines.push('');
      break;
    }

    case 'paragraph': {
      const text = renderInline(token.tokens ?? []);
      lines.push(text);
      if (nextType && nextType !== 'list' && nextType !== 'space') lines.push('');
      break;
    }

    case 'code': {
      const lang = token.lang ? chalk.dim(` ${token.lang}`) : '';
      lines.push(chalk.dim('┌─') + lang);
      for (const codeLine of token.text.split('\n')) {
        lines.push(chalk.dim('│ ') + chalk.cyan(codeLine));
      }
      lines.push(chalk.dim('└─'));
      if (nextType && nextType !== 'space') lines.push('');
      break;
    }

    case 'list': {
      const listToken = token as Token & { items: Array<{ tokens: Token[] }>; ordered: boolean; start?: number };
      const startNum = listToken.start ?? 1;
      for (let i = 0; i < listToken.items.length; i++) {
        const item = listToken.items[i];
        const bullet = listToken.ordered
          ? chalk.dim(`${startNum + i}. `)
          : chalk.cyan('- ');
        const itemText = renderListItem(item.tokens ?? []);
        lines.push(...wrapPrefixedText(bullet, itemText, contentWidth));
      }
      break;
    }

    case 'blockquote': {
      const quoteTokens = token.tokens ?? [];
      for (const qt of quoteTokens) {
        const quoteLines = renderToken(qt);
        for (const ql of quoteLines) {
          lines.push(chalk.dim('│ ') + chalk.italic(ql));
        }
      }
      if (nextType && nextType !== 'space') lines.push('');
      break;
    }

    case 'hr':
      lines.push(chalk.dim('─'.repeat(40)));
      if (nextType && nextType !== 'space') lines.push('');
      break;

    case 'space':
      lines.push('');
      break;

    case 'html':
      if ('raw' in token && typeof token.raw === 'string') {
        lines.push(token.raw.trim());
      }
      break;

    default:
      if ('text' in token && typeof token.text === 'string') {
        lines.push(token.text);
      }
  }

  return lines;
}

function renderListItem(tokens: Token[]): string {
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.type === 'text') {
      parts.push(
        token.tokens && token.tokens.length > 0
          ? renderInline(token.tokens)
          : token.text ?? '',
      );
    } else if (token.type === 'paragraph') {
      parts.push(renderInline(token.tokens ?? []));
    } else if ('text' in token && typeof token.text === 'string') {
      parts.push(token.text);
    }
  }
  return parts.join('');
}

function wrapPrefixedText(prefix: string, text: string, width: number): string[] {
  const plainPrefix = stripAnsi(prefix);
  const available = Math.max(20, width - plainPrefix.length);
  const rawLines = text.split('\n');
  const lines: string[] = [];

  for (const rawLine of rawLines) {
    const wrapped = wrapText(rawLine, available);
    for (let i = 0; i < wrapped.length; i++) {
      lines.push((i === 0 ? prefix : ' '.repeat(plainPrefix.length)) + wrapped[i]);
    }
  }

  return lines.length > 0 ? lines : [prefix];
}

function wrapText(text: string, width: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  let current = '';

  for (const segment of text.split(/(\s+)/u)) {
    if (!segment) continue;
    const next = current + segment;
    if (visibleLength(next) <= width || !current) {
      current = next;
      continue;
    }
    lines.push(current.trimEnd());
    current = segment.trimStart();
  }

  if (current) lines.push(current.trimEnd());
  return lines;
}

function visibleLength(text: string): number {
  return stringWidth(stripAnsi(text));
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function preprocessMarkdown(text: string): string {
  // marked 会把 CLI 菜单里的 "1)" 解析成有序列表，并把后续 "q)" 当作上一项续行。
  // 只转义行首数字右括号，保留常见 Markdown 的 "1." 有序列表行为。
  return text.replace(/^(\s*\d+)\)/gm, '$1\\)');
}

function renderInline(tokens: Token[]): string {
  let result = '';
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        if (token.tokens && token.tokens.length > 0) {
          result += renderInline(token.tokens);
        } else {
          result += token.text ?? '';
        }
        break;

      case 'strong':
        result += chalk.bold(renderInline(token.tokens ?? []));
        break;

      case 'em':
        result += chalk.italic(renderInline(token.tokens ?? []));
        break;

      case 'codespan':
        result += chalk.cyan(token.text ?? '');
        break;

      case 'link': {
        const linkText = renderInline(token.tokens ?? []);
        const href = (token as Tokens.Link).href ?? '';
        if (linkText === href) {
          result += chalk.underline.blue(linkText);
        } else {
          result += chalk.underline.blue(linkText) + chalk.dim(` (${href})`);
        }
        break;
      }

      case 'del':
        result += chalk.strikethrough(renderInline(token.tokens ?? []));
        break;

      case 'br':
        result += '\n';
        break;

      default:
        if ('text' in token && typeof token.text === 'string') {
          result += token.text;
        }
    }
  }
  return result;
}
