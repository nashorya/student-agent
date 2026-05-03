import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { execSync } from 'node:child_process';
import { createActor } from 'xstate';
import { streamSimple, getModel } from '@mariozechner/pi-ai';
import type { Context } from '@mariozechner/pi-ai';
import { createStudentAgentMachine } from './core/state-machine/machine.js';
import { StreamAdapter } from './core/state-machine/stream-adapter.js';
import { AlwaysAllowProvider, Executor, SnapshotManager } from './core/executor/index.js';
import type { TaskPlan } from './core/state-machine/types.js';
import { resourceManager } from './core/state-machine/resource-manager.js';
import { ReflectAgent } from './reflect/reflect-agent.js';
import { PreferenceCandidatesManager } from './memory/candidates/manager.js';
import { PreferencesManager } from './memory/preferences/manager.js';

const baseModel = getModel('anthropic', 'claude-sonnet-4-6');
const model = {
  ...baseModel,
  baseUrl: process.env.ANTHROPIC_BASE_URL ?? baseModel.baseUrl,
};

async function runTask(userInput: string): Promise<void> {
  const snapshotManager = new SnapshotManager(process.cwd());
  const executor = new Executor({
    snapshotManager,
    confirmationProvider: new AlwaysAllowProvider(),
    tools: new Map(),
    onSnapshot: (sha) => actor.send({ type: 'SNAPSHOT_CREATED', sha }),
  });
  const machine = createStudentAgentMachine(snapshotManager, { executor });
  const actor = createActor(machine);

  // 阶段一：Planner（阶段二）和 UI（阶段三）均未实现，自动推进中间状态
  actor.subscribe((snapshot) => {
    const state = snapshot.value;
    if (state === 'planning') {
      const plan: TaskPlan = { id: `plan_${Date.now()}`, steps: [userInput] };
      actor.send({ type: 'PLAN_READY', plan });
    }
    if (state === 'awaiting_confirmation') {
      actor.send({ type: 'USER_CONFIRMED' });
    }
  });

  actor.start();

  // 触发状态机进入 executing（经由 planning → awaiting_confirmation → executing）
  actor.send({ type: 'START_TASK', input: userInput });
  const taskId = actor.getSnapshot().context.taskId;
  const signal = taskId ? resourceManager.getAbortSignal(taskId) : undefined;
  const adapter = new StreamAdapter(actor.send.bind(actor), signal);

  const context: Context = {
    systemPrompt: 'You are a coding assistant. Use tools to help with programming tasks.',
    messages: [{ role: 'user', content: userInput, timestamp: Date.now() }],
  };

  try {
    const stream = streamSimple(model, context);
    await adapter.attachToStream(stream);
    // attachToStream 消费完流后，result() 已 resolve；打印文本内容
    const msg = await Promise.race([
      stream.result(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('stream.result() timeout')), 5000),
      ),
    ]);
    if (msg.stopReason === 'error' || msg.errorMessage) {
      console.error(`[LLM error] ${msg.errorMessage ?? msg.stopReason}`);
      actor.send({ type: 'EXECUTION_FAILED', error: msg.errorMessage ?? 'LLM error' });
      return;
    }
    const text = msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('');
    if (text) process.stdout.write(text + '\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[error] ${message}`);
    actor.send({ type: 'EXECUTION_FAILED', error: message });
  }

  // 等待状态机完成异步操作（questions 写入等）
  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  actor.stop();

  // 异步运行 ReflectAgent（不阻塞主循环）
  runReflectAgent(userInput).catch((err: unknown) => {
    console.error('[ReflectAgent]', err instanceof Error ? err.message : String(err));
  });
}

let taskCount = 0;

/** 获取本次任务的 git diff */
function getGitDiff(): string {
  try {
    return execSync('git diff HEAD~1 HEAD', { encoding: 'utf-8', timeout: 5000 });
  } catch {
    return '';
  }
}

/** 异步运行 ReflectAgent */
async function runReflectAgent(taskDescription: string): Promise<void> {
  taskCount++;
  const agent = new ReflectAgent(
    PreferenceCandidatesManager.getInstance(),
    PreferencesManager.getInstance(),
  );
  const result = await agent.run({
    taskId: `task_${Date.now()}`,
    sessionRef: `session_${Date.now()}`,
    taskDescription,
    gitDiff: getGitDiff(),
    totalTaskCount: taskCount,
  });
  if (result.patternsExtracted > 0) {
    console.log(`[Reflect] 提取 ${result.patternsExtracted} 个模式，升级 ${result.promoted.length} 条偏好`);
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input, output });
  console.log('Student Agent (阶段二) — 输入 /quit 退出');

  while (true) {
    const userInput = await rl.question('\n> ');
    if (userInput === '/quit') break;
    if (!userInput.trim()) continue;

    try {
      await runTask(userInput);
    } catch (err) {
      console.error('Task error:', err instanceof Error ? err.message : String(err));
    }
  }

  rl.close();
}

main().catch((err: unknown) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
