/**
 * Slash Command 解析器。
 * 只处理以 / 开头的命令，不用外部库。
 */

export type SlashCommand =
  | { type: 'quit' }
  | { type: 'help' }
  | { type: 'status' }
  | { type: 'setting' }
  | { type: 'clear' }
  | { type: 'candidates' }
  | { type: 'init' }
  | { type: 'feedback'; rating: 'up' | 'down'; comment: string }
  | { type: 'task'; subcommand: 'rename'; name: string }
  | { type: 'task'; subcommand: 'status' }
  | { type: 'unknown'; raw: string };

export const COMMANDS = [
  '/help',
  '/h',
  '/?',
  '/quit',
  '/exit',
  '/q',
  '/status',
  '/setting',
  '/settings',
  '/clear',
  '/candidates',
  '/init',
  '/feedback',
  '/task'
];

/**
 * 解析用户输入。
 * 非 / 开头的输入返回 null（表示普通消息）。
 */
export function parseCommand(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

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

    case 'setting':
    case 'settings':
      return { type: 'setting' };

    case 'clear':
      return { type: 'clear' };

    case 'candidates':
      return { type: 'candidates' };

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

    case 'task': {
      if (args[0] === 'rename' && args.length >= 2) {
        return { type: 'task', subcommand: 'rename', name: args.slice(1).join(' ') };
      }
      return { type: 'task', subcommand: 'status' };
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
    '    /setting              重新配置 Provider / API Key',
    '    /clear                清空屏幕',
    '    /candidates           查看偏好候选',
    '    /init                     将当前目录初始化为 git 仓库（启用快照回滚）',
    '    /feedback up|down [评论]  提交质量反馈',
    '    /task                 查看当前任务状态',
    '    /task rename <名字>   重命名当前任务',
    '',
  ].join('\n');
}
