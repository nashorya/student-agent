/**
 * CLI 启动 Banner。
 */

import chalk from 'chalk';

export function printBanner(): void {
  const lines = [
    '',
    chalk.bold.cyan('  Student Agent'),
    chalk.dim('  基于 Pi 的 CLI 编程代理'),
    '',
    chalk.dim('  输入 /help 查看命令，/quit 退出'),
    '',
  ];
  console.log(lines.join('\n'));
}
