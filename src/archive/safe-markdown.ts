import { Marked } from 'marked';
import { escapeHtml } from './html-escape.js';

const markdown = new Marked({ gfm: true, breaks: false });

export function renderSafeMarkdown(source: string): string {
  if (!source.trim()) return '<p class="archive-empty">No detail content recorded.</p>';
  return markdown.lexer(source).map(renderBlock).join('');
}

function renderBlock(token: any): string {
  switch (token.type) {
    case 'space': return '';
    case 'heading': {
      const level = Math.min(6, Number(token.depth || 1) + 1);
      return `<h${level}>${renderInline(token.tokens || [])}</h${level}>`;
    }
    case 'paragraph': return `<p>${renderInline(token.tokens || [])}</p>`;
    case 'text': return token.tokens ? renderInline(token.tokens) : escapeHtml(String(token.text || ''));
    case 'code': {
      const language = String(token.lang || '').split(/\s+/)[0];
      const className = language ? ` class="language-${escapeHtml(language)}"` : '';
      return `<pre><code${className}>${escapeHtml(String(token.text || ''))}</code></pre>`;
    }
    case 'blockquote': return `<blockquote>${(token.tokens || []).map(renderBlock).join('')}</blockquote>`;
    case 'list': {
      const tag = token.ordered ? 'ol' : 'ul';
      const start = token.ordered && Number(token.start) > 1 ? ` start="${Number(token.start)}"` : '';
      return `<${tag}${start}>${(token.items || []).map(renderListItem).join('')}</${tag}>`;
    }
    case 'table': return renderTable(token);
    case 'hr': return '<hr>';
    case 'html': return `<pre class="archive-raw-html"><code>${escapeHtml(String(token.raw || ''))}</code></pre>`;
    default: return token.tokens ? renderInline(token.tokens) : escapeHtml(String(token.text || ''));
  }
}

function renderListItem(item: any): string {
  const checked = typeof item.checked === 'boolean'
    ? `<span class="task-check" aria-label="${item.checked ? 'complete' : 'incomplete'}">${item.checked ? '✓' : '○'}</span>`
    : '';
  return `<li>${checked}${(item.tokens || []).map(renderBlock).join('')}</li>`;
}

function renderTable(token: any): string {
  const header = (token.header || []).map((cell: any) => `<th>${renderInline(cell.tokens || [])}</th>`).join('');
  const rows = (token.rows || []).map((row: any[]) => `<tr>${row.map((cell: any) => `<td>${renderInline(cell.tokens || [])}</td>`).join('')}</tr>`).join('');
  return `<div class="detail-table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderInline(tokens: any[]): string {
  return tokens.map((token) => {
    switch (token.type) {
      case 'text': return token.tokens ? renderInline(token.tokens) : escapeHtml(String(token.text || ''));
      case 'escape': return escapeHtml(String(token.text || ''));
      case 'strong': return `<strong>${renderInline(token.tokens || [])}</strong>`;
      case 'em': return `<em>${renderInline(token.tokens || [])}</em>`;
      case 'codespan': return `<code>${escapeHtml(String(token.text || ''))}</code>`;
      case 'del': return `<del>${renderInline(token.tokens || [])}</del>`;
      case 'br': return '<br>';
      case 'link': {
        const label = renderInline(token.tokens || []);
        const href = safeHref(String(token.href || ''));
        if (!href) return label;
        const rel = /^https?:/i.test(href) ? ' rel="noreferrer"' : '';
        const title = token.title ? ` title="${escapeHtml(String(token.title))}"` : '';
        return `<a href="${escapeHtml(href)}"${rel}${title}>${label}</a>`;
      }
      case 'image': return `<span class="image-reference">${escapeHtml(String(token.text || token.href || 'Image'))}</span>`;
      case 'html': return escapeHtml(String(token.raw || ''));
      default: return token.tokens ? renderInline(token.tokens) : escapeHtml(String(token.text || token.raw || ''));
    }
  }).join('');
}

function safeHref(value: string): string | undefined {
  const href = value.trim();
  if (/^(?:https?:|#|\.\.?\/|\/)/i.test(href)) return href;
  if (/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(href)) return href;
  return undefined;
}
