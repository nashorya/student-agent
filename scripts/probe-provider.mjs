// scripts/probe-provider.mjs — 用法:
// PROBE_BASE_URL=https://open.bigmodel.cn/api/paas/v4 PROBE_API_KEY=xxx \
//   node scripts/probe-provider.mjs glm-5.2
import { createHash } from "node:crypto";

const base = process.env.PROBE_BASE_URL?.replace(/\/$/, "");
const key = process.env.PROBE_API_KEY;
const model = process.argv[2] ?? "glm-5.2";

if (!base || !key) {
  console.error("need PROBE_BASE_URL / PROBE_API_KEY");
  process.exit(1);
}

async function chat(extra, tag) {
  const t0 = Date.now();
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 512,
      messages: [{ role: "user", content: "137*24等于多少?只回答数字。" }],
      ...extra,
    }),
  });

  let json;
  try {
    json = await response.json();
  } catch {
    json = {};
  }

  const message = json.choices?.[0]?.message ?? {};
  const reasoning = message.reasoning_content ?? "";
  return {
    tag,
    http: response.status,
    ms: Date.now() - t0,
    modelEcho: json.model,
    text: (message.content ?? "").slice(0, 60),
    hasReasoningContent: Boolean(reasoning),
    reasoningChars: reasoning.length,
    reasoningSha256: reasoning
      ? createHash("sha256").update(reasoning).digest("hex")
      : undefined,
    usage: json.usage,
    error: json.error?.message,
  };
}

const out = {};
out.plain = await chat({}, "plain");
out.thinkingOn = await chat({ thinking: { type: "enabled" } }, "thinkingOn");
const pinnedPolicy = { thinking: { type: "enabled" }, do_sample: false };
out.det1 = await chat(pinnedPolicy, "det1");
out.det2 = await chat(pinnedPolicy, "det2");
out.deterministicAtPinnedPolicy = out.det1.text === out.det2.text &&
  out.det1.reasoningSha256 === out.det2.reasoningSha256;

console.log(JSON.stringify(out, null, 2));
