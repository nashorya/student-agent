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
  | { type: 'model' }
  | { type: 'clear' }
  | { type: 'candidates' }
  | { type: 'context' }
  | { type: 'init' }
  | { type: 'paste'; content: string }
  | { type: 'feedback'; rating: 'up' | 'down'; comment: string }
  | { type: 'review'; rating: 'up' | 'ok' | 'down'; comment: string }
  | { type: 'why'; query: string; trace: boolean }
  | { type: 'plan'; subcommand: 'revision'; content: string }
  | { type: 'plan'; subcommand: 'revisions'; query: string }
  | { type: 'task'; subcommand: 'rename'; name: string }
  | { type: 'task'; subcommand: 'status' }
  | { type: 'task'; subcommand: 'cancel' }
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
  '/model',
  '/clear',
  '/candidates',
  '/context',
  '/init',
  '/paste',
  '/feedback',
  '/review',
  '/why',
  '/plan',
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
  '/plan revision ',
  '/plan revisions ',
  '/task status',
  '/task rename ',
  '/task cancel',
  '/archive status',
  '/archive init',
  '/archive check',
  '/archive build',
  '/archive adr new ',
  '/archive bug open ',
  '/archive bug update ',
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

    case 'model':
      return { type: 'model' };

    case 'clear':
      return { type: 'clear' };

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
      if (args[0] === 'revision' && args.length >= 2) {
        return { type: 'plan', subcommand: 'revision', content: args.slice(1).join(' ') };
      }
      if (args[0] === 'revisions') {
        return { type: 'plan', subcommand: 'revisions', query: args.slice(1).join(' ') };
      }
      return { type: 'unknown', raw: trimmed };
    }

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
    '    /help, /h, /?         显示此帮助',
    '    /quit, /exit, /q      退出',
    '    /status               显示当前状态',
    '    /abort                中止当前运行中的任务（TUI 中也可按 Esc）',
    '    /setting              重新配置 Provider / API Key',
    '    /model                快速切换模型（保持其他设置不变）',
    '    /clear                清空屏幕',
    '    /candidates           查看偏好候选',
    '    /context              查看当前三层上下文状态',
    '    /init                     将当前目录初始化为 git 仓库（启用快照回滚）',
    '    /paste ... /end           粘贴多行内容并作为一条消息提交',
    '    /feedback up|down [评论]  提交质量反馈',
    '    /review up|ok|down [评论]  静默记录本轮信心投票',
    '    /why [关键词] [--trace]    查看决策来源',
    '    /plan revision <内容>       记录一次用户计划修订',
    '    /plan revisions [关键词]    查看计划修订记忆',
    '    /task                 查看当前任务状态',
    '    /task rename <名字>   重命名当前任务',
    '    /task cancel          丢弃当前活跃任务',
    '    /archive status|init|check|build  查看、初始化、检查或构建项目档案',
    '    /archive adr new <标题>            暂存新 ADR',
    '    /archive bug open <标题>           暂存新 bug',
    '    /archive bug update <ID> [状态]    暂存 bug 更新',
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
