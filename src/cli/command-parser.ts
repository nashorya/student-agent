/**
 * Slash Command 解析器。
 * 只处理以 / 开头的命令，不用外部库。
 */
import type { BugStatus } from '../archive/types.js';

export type ArchiveSlashCommand =
  | { type: 'archive'; subcommand: 'status' | 'init' | 'check' | 'build' }
  | { type: 'archive'; subcommand: 'adr-new'; title: string }
  | { type: 'archive'; subcommand: 'bug-open'; title: string }
  | { type: 'archive'; subcommand: 'bug-update'; id: string; status?: BugStatus };

export type SlashCommand =
  | ArchiveSlashCommand
  | { type: 'quit' }
  | { type: 'help' }
  | { type: 'status' }
  | { type: 'abort' }
  | { type: 'setting' }
  | { type: 'provider' }
  | { type: 'model' }
  /** Pi CLI command; Student Agent uses /setting instead. */
  | { type: 'login' }
  | { type: 'clear' }
  | { type: 'candidates' }
  | { type: 'context' }
  | { type: 'init' }
  | { type: 'paste'; content: string }
  | { type: 'feedback'; rating: 'up' | 'down'; comment: string }
  | { type: 'review'; rating: 'up' | 'ok' | 'down'; comment: string }
  | { type: 'why'; query: string; trace: boolean }
  /** Codex-style: enter Plan mode; optional inline goal starts a planning turn. */
  | { type: 'plan'; goal: string }
  /** Leave Plan mode (back to normal execute collaboration). */
  | { type: 'execute' }
  /** Explicit plan-revision memory (was historically under /plan revision). */
  | { type: 'revision'; content: string }
  | { type: 'revisions'; query: string }
  | { type: 'task'; subcommand: 'rename'; name: string }
  | { type: 'task'; subcommand: 'status' }
  | { type: 'task'; subcommand: 'cancel' }
  | { type: 'new' }
  | { type: 'resume'; query: string }
  | { type: 'sessions' }
  | { type: 'unknown'; raw: string };

export const COMMANDS = [
  '/help',
  '/h',
  '/?',
  '/quit',
  '/exit',
  '/q',
  '/status',
  '/abort',
  '/setting',
  '/provider',
  '/model',
  '/clear',
  '/new',
  '/resume',
  '/sessions',
  '/candidates',
  '/context',
  '/init',
  '/paste',
  '/feedback',
  '/review',
  '/why',
  '/plan',
  '/execute',
  '/revision',
  '/revisions',
  '/task',
  '/archive',
];

export const COMMAND_COMPLETIONS = [
  ...COMMANDS,
  '/feedback up ',
  '/feedback down ',
  '/review up ',
  '/review ok ',
  '/review down ',
  '/why ',
  '/why --trace',
  '/plan ',
  '/revision ',
  '/revisions ',
  '/task status',
  '/task rename ',
  '/task cancel',
  '/new',
  '/resume ',
  '/sessions',
  '/archive status',
  '/archive init',
  '/archive check',
  '/archive build',
  '/archive adr new ',
  '/archive bug open ',
  '/archive bug update ',
];

/**
 * Slash-menu entries for pi-tui CombinedAutocompleteProvider.
 * `name` is WITHOUT the leading `/` (provider adds it on apply).
 */
export type SlashMenuCommand = {
  name: string;
  description: string;
  argumentHint?: string;
};

export const SLASH_MENU_COMMANDS: SlashMenuCommand[] = [
  { name: 'help', description: '显示帮助' },
  { name: 'status', description: '显示状态' },
  { name: 'new', description: '新会话' },
  { name: 'sessions', description: '列出会话' },
  { name: 'resume', description: '恢复会话', argumentHint: '[名称]' },
  { name: 'abort', description: '中止运行' },
  { name: 'clear', description: '清空 transcript' },
  { name: 'setting', description: '配置 Provider' },
  { name: 'provider', description: '切换 Provider' },
  { name: 'model', description: '切换模型' },
  { name: 'context', description: '查看上下文' },
  { name: 'candidates', description: '查看候选' },
  { name: 'init', description: 'git init' },
  { name: 'plan', description: 'Plan 模式', argumentHint: '[目标]' },
  { name: 'execute', description: '退出 Plan 模式' },
  { name: 'revision', description: '记录计划修订', argumentHint: '<内容>' },
  { name: 'revisions', description: '查看计划修订', argumentHint: '[关键词]' },
  { name: 'task', description: '任务', argumentHint: 'status|rename|cancel' },
  { name: 'archive', description: '档案', argumentHint: 'status|init|…' },
  { name: 'feedback', description: '质量反馈', argumentHint: 'up|down' },
  { name: 'review', description: '信心投票', argumentHint: 'up|ok|down' },
  { name: 'why', description: '决策来源', argumentHint: '[关键词]' },
  { name: 'quit', description: '退出' },
];

/**
 * 解析用户输入。
 * 非 / 开头的输入返回 null（表示普通消息）。
 */
export function parseCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  if (/^\/paste(?:\s|$)/iu.test(trimmed)) {
    return parsePasteCommand(trimmed);
  }

  const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
  const commandName = cmd.toLowerCase();

  switch (commandName) {
    case 'quit':
    case 'exit':
    case 'q':
      return { type: 'quit' };

    case 'help':
    case 'h':
    case '?':
      return { type: 'help' };

    case 'status':
      return { type: 'status' };

    case 'abort':
    case 'stop':
    case 'cancel':
      return { type: 'abort' };

    case 'setting':
    case 'settings':
      return { type: 'setting' };

    case 'provider':
      return { type: 'provider' };

    case 'model':
      return { type: 'model' };

    case 'login':
      return { type: 'login' };

    case 'clear':
      return { type: 'clear' };

    case 'new':
      return { type: 'new' };

    case 'resume':
      return { type: 'resume', query: args.join(' ').trim() };

    case 'sessions':
    case 'session':
      // `/session` alone lists; `/session new` maps to new for convenience.
      if (args[0]?.toLowerCase() === 'new') return { type: 'new' };
      if (args[0]?.toLowerCase() === 'list' || args.length === 0) return { type: 'sessions' };
      return { type: 'resume', query: args.join(' ').trim() };

    case 'candidates':
      return { type: 'candidates' };

    case 'context':
      return { type: 'context' };

    case 'init':
      return { type: 'init' };

    case 'feedback': {
      const rating = args[0] as 'up' | 'down' | undefined;
      if (rating !== 'up' && rating !== 'down') {
        return { type: 'unknown', raw: trimmed };
      }
      const comment = args.slice(1).join(' ') || '';
      return { type: 'feedback', rating, comment };
    }

    case 'review': {
      const rating = args[0] as 'up' | 'ok' | 'down' | undefined;
      if (rating !== 'up' && rating !== 'ok' && rating !== 'down') {
        return { type: 'unknown', raw: trimmed };
      }
      return { type: 'review', rating, comment: args.slice(1).join(' ') || '' };
    }

    case 'why': {
      const trace = args.includes('--trace');
      const query = args.filter((arg) => arg !== '--trace').join(' ');
      return { type: 'why', query, trace };
    }

    case 'plan': {
      // Backward compat: old memory commands lived under /plan revision(s).
      if (args[0]?.toLowerCase() === 'revision' && args.length >= 2) {
        return { type: 'revision', content: args.slice(1).join(' ') };
      }
      if (args[0]?.toLowerCase() === 'revisions') {
        return { type: 'revisions', query: args.slice(1).join(' ') };
      }
      return { type: 'plan', goal: args.join(' ').trim() };
    }

    case 'execute':
      return { type: 'execute' };

    case 'revision': {
      const content = args.join(' ').trim();
      if (!content) return { type: 'unknown', raw: trimmed };
      return { type: 'revision', content };
    }

    case 'revisions':
      return { type: 'revisions', query: args.join(' ').trim() };

    case 'task': {
      if (args[0] === 'rename' && args.length >= 2) {
        return { type: 'task', subcommand: 'rename', name: args.slice(1).join(' ') };
      }
      if (args[0] === 'cancel' || args[0] === 'clear') {
        return { type: 'task', subcommand: 'cancel' };
      }
      return { type: 'task', subcommand: 'status' };
    }

    case 'archive': {
      const subcommand = args[0]?.toLowerCase();
      if (subcommand === 'status' || subcommand === 'init' || subcommand === 'check' || subcommand === 'build') return { type: 'archive', subcommand };
      if (subcommand === 'adr' && args[1]?.toLowerCase() === 'new' && args.length >= 3) return { type: 'archive', subcommand: 'adr-new', title: args.slice(2).join(' ') };
      if (subcommand === 'bug' && args[1]?.toLowerCase() === 'open' && args.length >= 3) return { type: 'archive', subcommand: 'bug-open', title: args.slice(2).join(' ') };
      if (subcommand === 'bug' && args[1]?.toLowerCase() === 'update' && args[2]) {
        const status = normalizeBugStatus(args[3]);
        if (args[3] && !status) return { type: 'unknown', raw: trimmed };
        return { type: 'archive', subcommand: 'bug-update', id: args[2].toUpperCase(), status };
      }
      return { type: 'unknown', raw: trimmed };
    }

    default:
      return { type: 'unknown', raw: trimmed };
  }
}

/**
 * 返回帮助文本。
 */
export function getHelpText(): string {
  return [
    '',
    '  可用命令：',
    '    /help, /h, /?         显示帮助',
    '    /quit, /exit, /q      退出',
    '    /status               显示状态',
    '    /abort                中止运行',
    '    /setting              配置 Provider',
    '    /provider             切换 Provider',
    '    /model                切换模型',
    '    /login                改用 /setting',
    '    /clear                清空 transcript',
    '    /new                  新会话',
    '    /resume [名称]        恢复会话',
    '    /sessions             列出会话',
    '    /candidates           查看候选',
    '    /context              查看上下文',
    '    /init                 git init',
    '    /paste ... /end       粘贴多行',
    '    /feedback up|down     质量反馈',
    '    /review up|ok|down    信心投票',
    '    /why [关键词]         决策来源',
    '    /plan [目标]          Plan 模式',
    '    /execute              退出 Plan 模式',
    '    /revision <内容>      记录计划修订',
    '    /revisions [关键词]   查看计划修订',
    '    /task                 任务状态',
    '    /task rename <名字>   重命名任务',
    '    /task cancel          取消任务',
    '    /archive status|init|check|build',
    '    /archive adr new <标题>',
    '    /archive bug open <标题>',
    '    /archive bug update <ID> [状态]',
    '',
  ].join('\n');
}

function normalizeBugStatus(value: string | undefined): BugStatus | undefined {
  if (!value) return undefined;
  const status = value.toUpperCase();
  const allowed: BugStatus[] = ['OPEN', 'INVESTIGATING', 'FIXED', 'CLOSED', 'WONTFIX', 'DUPLICATE', 'CANNOT_REPRODUCE', 'REOPENED'];
  return allowed.includes(status as BugStatus) ? status as BugStatus : undefined;
}

function parsePasteCommand(trimmed: string): SlashCommand {
  const normalized = trimmed.replace(/\r\n/g, '\n');
  const afterPaste = normalized.replace(/^\/paste[ \t]*/iu, '').replace(/^\n/u, '');
  const lines = afterPaste.split('\n');
  const endIndex = lines.findIndex((line) => line.trim().toLowerCase() === '/end');
  if (endIndex < 0) {
    return { type: 'unknown', raw: trimmed };
  }
  return {
    type: 'paste',
    content: lines.slice(0, endIndex).join('\n'),
  };
}
