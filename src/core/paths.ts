/**
 * 路径解析：统一封装"项目工作目录"与"项目 memory 目录"的读取逻辑。
 *
 * 背景：bin/student-agent 启动时会 process.chdir() 到 agent 安装目录，
 * 真实用户 cwd 被写入 STUDENT_AGENT_CWD。任何需要写入项目内的代码
 * （memory/、快照等）都必须从此 helper 取目录，不能直接用 process.cwd()，
 * 否则打包发布后会写到 agent 安装目录而不是用户项目。
 *
 * 实现为函数而非常量：确保 dotenv / 测试 setEnv 在模块 import 之后
 * 调整 STUDENT_AGENT_CWD 也能被正确读到。
 */

import { join } from 'node:path';

/** 当前项目工作目录。优先读 STUDENT_AGENT_CWD，未设置时回落到 process.cwd()。 */
export function getProjectCwd(): string {
  const fromEnv = process.env.STUDENT_AGENT_CWD;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return process.cwd();
}

/** 当前项目的 memory 目录（{projectCwd}/memory）。 */
export function getProjectMemoryDir(): string {
  return join(getProjectCwd(), 'memory');
}
