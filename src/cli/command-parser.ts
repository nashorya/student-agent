/**
 * Slash Command 解析器。
 * 只处理以 / 开头的命令，不用外部库。
 */

export type SlashCommand =
  | { type: 'quit' }
  | { type: 'help' }
  | { type: 'status' }
  | { type: 'clear' }
  | { type: 'candidates' }
  | { type: 'feedback'; rating: 'up' | 'down'; comment: string }
  | { type: 'unknown'; raw: string };

export const COMMANDS = [
  '/help',
  '/h',
  '/?',
  '/quit',
  '/exit',
  '/q',
  '/status',
  '/clear',
  '/candidates',
  '/feedback'
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

    case 'clear':
      return { type: 'clear' };

    case 'candidates':
      return { type: 'candidates' };

    case 'feedback': {
      const rating = args[0] as 'up' | 'down' | undefined;
      if (rating !== 'up' && rating !== 'down') {
        return { type: 'unknown', raw: trimmed };
      }
      const comment = args.slice(1).join(' ') || '';
      return { type: 'feedback', rating, comment };
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
    '    /clear                清空屏幕',
    '    /candidates           查看偏好候选',
    '    /feedback up|down [评论]  提交质量反馈',
    '',
  ].join('\n');
}
