// Probe how the proxy mangles tool_use names on the anthropic-messages path.
// For each agent tool, force tool_choice and record the name the proxy returns.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const env = Object.fromEntries(
  readFileSync(join(homedir(), '.student-agent', '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const BASE = (env.STUDENT_AGENT_BASE_URL || 'https://api.muskapi.cc').replace(/\/$/, '');
const KEY = env.ANTHROPIC_API_KEY;
const MODEL = env.STUDENT_AGENT_MODEL || 'claude-sonnet-4-6';

const TOOLS = ['read', 'write', 'edit', 'bash', 'list_files', 'glob', 'search_files', 'read_many', 'apply_patch'];

async function probe(toolName) {
  const body = {
    model: MODEL,
    max_tokens: 256,
    tools: [{
      name: toolName,
      description: `Test tool ${toolName}`,
      input_schema: { type: 'object', properties: { x: { type: 'string' } }, required: [] },
    }],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: `Call the ${toolName} tool now.` }],
  };
  const res = await fetch(`${BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY,
      'authorization': `Bearer ${KEY}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) return { sent: toolName, returned: `HTTP ${res.status}`, raw: text.slice(0, 120) };
  let json;
  try { json = JSON.parse(text); } catch { return { sent: toolName, returned: 'PARSE_ERR', raw: text.slice(0, 120) }; }
  const block = (json.content || []).find((b) => b.type === 'tool_use');
  return { sent: toolName, returned: block ? block.name : `no_tool_use (stop=${json.stop_reason})` };
}

console.log(`BASE=${BASE}  MODEL=${MODEL}\n`);
for (const t of TOOLS) {
  try {
    const r = await probe(t);
    const flag = r.returned === t ? 'OK ' : '>>>';
    console.log(`${flag} ${r.sent.padEnd(14)} -> ${r.returned}${r.raw ? '  ' + r.raw : ''}`);
  } catch (e) {
    console.log(`ERR ${t.padEnd(14)} -> ${e.message}`);
  }
}
