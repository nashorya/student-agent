import { Type } from '../pi-compat/index.js';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { getProjectMemoryDir } from '../paths.js';
import { ToolboxRegistry, runToolboxTool } from '../../memory/toolbox/index.js';

export interface ToolboxToolOptions {
  memoryDir?: string;
}

interface ToolboxInput {
  action: 'list' | 'describe' | 'run' | 'create' | 'update' | 'disable';
  name?: string;
  args?: Record<string, unknown>;
  source?: string;
}

/** Adoption cue: second-time clumsy op → create a project-local tool that returns only what is needed. */
export const TOOLBOX_ADOPTION_GUIDELINE =
  '当你发现自己在这个项目里第二次做同样的笨重操作(重复的搜索、解析、格式化、从长输出里提取固定信息),用 toolbox create 把它固化成工具,下次一次调用解决。工具应该返回"恰好需要的信息",而不是原始材料。';

const schema = Type.Object({
  action: Type.Union([
    Type.Literal('list'),
    Type.Literal('describe'),
    Type.Literal('run'),
    Type.Literal('create'),
    Type.Literal('update'),
    Type.Literal('disable'),
  ]),
  name: Type.Optional(Type.String({ description: 'Tool name (required for describe/run/create/update/disable).' })),
  args: Type.Optional(Type.Object({}, { additionalProperties: true, description: 'Arguments for run.' })),
  source: Type.Optional(Type.String({ description: 'Full module source for create/update.' })),
});

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text' as const, text }],
    details,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function requireName(name: string | undefined, action: string): string | undefined {
  if (typeof name !== 'string' || !name.trim()) {
    return `Missing name for toolbox ${action}.`;
  }
  return undefined;
}

function formatListLine(tool: { name: string; description: string; disabled: boolean }): string {
  const desc = tool.description?.trim() ? tool.description.trim() : '(no description)';
  const mark = tool.disabled ? ' [disabled]' : '';
  return `${tool.name} — ${desc}${mark}`;
}

function formatDescribe(tool: {
  name: string;
  description: string;
  disabled: boolean;
  params?: Record<string, unknown>;
  stats: {
    calls: number;
    consecutiveFailures: number;
    lastUsedAt: string | null;
    disabled: boolean;
    disabledReason?: string;
  };
  loadError?: string;
}): string {
  const lines = [
    `name: ${tool.name}`,
    `description: ${tool.description || '(none)'}`,
    `disabled: ${tool.disabled}`,
    `params: ${tool.params !== undefined ? JSON.stringify(tool.params) : '(none)'}`,
    `calls: ${tool.stats.calls}`,
    `consecutiveFailures: ${tool.stats.consecutiveFailures}`,
    `lastUsedAt: ${tool.stats.lastUsedAt ?? 'null'}`,
    `stats.disabled: ${tool.stats.disabled}`,
  ];
  if (tool.stats.disabledReason) {
    lines.push(`disabledReason: ${tool.stats.disabledReason}`);
  }
  if (tool.loadError) {
    lines.push(`loadError: ${tool.loadError}`);
  }
  return lines.join('\n');
}

export function createToolboxToolDefinition(options: ToolboxToolOptions = {}) {
  return defineTool({
    name: 'toolbox',
    label: 'toolbox',
    description:
      'Project-local toolbox: list, describe, run, create, update, or disable tools under memory/toolbox.',
    promptSnippet: 'Use toolbox to create/run project-local helpers for repeated operations',
    promptGuidelines: [TOOLBOX_ADOPTION_GUIDELINE],
    parameters: schema,
    async execute(
      _toolCallId: string,
      params: ToolboxInput,
    ): Promise<{ content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }> {
      try {
        const memoryDir = options.memoryDir ?? getProjectMemoryDir();
        const registry = new ToolboxRegistry(memoryDir);
        const action = params.action;

        switch (action) {
          case 'list': {
            await registry.load();
            const tools = registry.list();
            if (tools.length === 0) {
              return textResult('No tools in toolbox.');
            }
            return textResult(tools.map(formatListLine).join('\n'), { count: tools.length });
          }

          case 'describe': {
            const nameErr = requireName(params.name, 'describe');
            if (nameErr) return textResult(nameErr);
            await registry.load();
            const described = registry.describe(params.name!);
            if (!described) {
              return textResult(`Unknown tool "${params.name}".`);
            }
            return textResult(formatDescribe(described), { name: described.name });
          }

          case 'run': {
            const nameErr = requireName(params.name, 'run');
            if (nameErr) return textResult(nameErr);
            const name = params.name!;
            await registry.load();
            const described = registry.describe(name);
            if (!described) {
              return textResult(`Unknown tool "${name}".`);
            }
            if (described.disabled) {
              const reason = described.stats.disabledReason
                ?? described.loadError
                ?? `Tool "${name}" is disabled.`;
              return textResult(reason, { name, disabled: true });
            }
            const result = await runToolboxTool({
              filePath: registry.toolPath(name),
              args: params.args ?? {},
            });
            const ok = !result.error && !result.timedOut;
            await registry.recordUsage(name, ok);
            return textResult(result.text, {
              name,
              ok,
              truncated: result.truncated,
              timedOut: result.timedOut,
              ...(result.error ? { error: result.error } : {}),
            });
          }

          case 'create': {
            const nameErr = requireName(params.name, 'create');
            if (nameErr) return textResult(nameErr);
            if (typeof params.source !== 'string' || !params.source) {
              return textResult('Missing source for toolbox create.');
            }
            await registry.createTool(params.name!, params.source);
            return textResult(`Created tool ${params.name}.`, { name: params.name });
          }

          case 'update': {
            const nameErr = requireName(params.name, 'update');
            if (nameErr) return textResult(nameErr);
            if (typeof params.source !== 'string' || !params.source) {
              return textResult('Missing source for toolbox update.');
            }
            await registry.updateTool(params.name!, params.source);
            return textResult(`Updated tool ${params.name}.`, { name: params.name });
          }

          case 'disable': {
            const nameErr = requireName(params.name, 'disable');
            if (nameErr) return textResult(nameErr);
            await registry.disableTool(params.name!, 'Disabled by toolbox disable');
            return textResult(`Disabled tool ${params.name}.`, { name: params.name });
          }

          default:
            return textResult(`Unknown toolbox action "${String(action)}".`);
        }
      } catch (error) {
        return textResult(errorMessage(error), { ok: false });
      }
    },
  });
}
