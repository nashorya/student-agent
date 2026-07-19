# 注入效果烟测 · 抓包/审计附录（脱敏）

生成: 2026-07-19T12:25:16.602Z
配置: `zhipu-glm-5.2`
总等价成本(本地估价): **$0.0000**

## 三门终判

| 门 | 结果 |
|----|------|
| 1 管线/B空库·阶梯·events | ✅ |
| 2 三臂注入对拍+skill 隔离 | ❌ |
| 3 live 蒸馏 causal pair | ❌ |
| **全通** | ❌ |

Notes: ["gate3: distill not ok (distill_null); synthetic/fallback may have been used for A/C inject check only","gate2: A/C inject markers not found in provider audit (policy only active for glm-5*)"]

## 臂摘要

```json
{
  "B": {
    "arm": "B",
    "costUsd": 0,
    "toolCalls": 5,
    "failedToolCalls": 0,
    "correctness": 1,
    "status": "success",
    "injectionHints": [
      "B_no_lesson_markers"
    ],
    "usedRecallIds": [],
    "providerBodyCount": 6,
    "runId": "run_1784463801665"
  },
  "A": {
    "arm": "A",
    "costUsd": 0,
    "toolCalls": 5,
    "failedToolCalls": 0,
    "correctness": 1,
    "status": "success",
    "injectionHints": [],
    "usedRecallIds": [],
    "providerBodyCount": 4,
    "runId": "run_1784463845235"
  },
  "C": {
    "arm": "C",
    "costUsd": 0,
    "toolCalls": 7,
    "failedToolCalls": 1,
    "correctness": 1,
    "status": "success",
    "injectionHints": [],
    "usedRecallIds": [],
    "providerBodyCount": 5,
    "runId": "run_1784463876035"
  },
  "distill": {
    "ok": false,
    "candidate": null,
    "reason": "distill_null",
    "eventsFound": true,
    "fallbackLesson": {
      "id": "knack_smoke_from_events_fallback",
      "summary": "Symptom: fetchUser missing. Fix: use getUser from api.cjs",
      "symptom": "api.fetchUser is not a function / TypeError",
      "fix": "replace fetchUser with getUser"
    }
  }
}
```

## 注入段摘录（脱敏，截断）

### B
```
{"index":1,"at":"2026-07-19T12:23:21.739Z","url":"https://open.bigmodel.cn/api/coding/paas/v4/chat/completions","model":"glm-5.2","thinking":{"type":"enabled"},"temperature":0,"doSample":false,"compliant":true,"response":{"httpStatus":200,"inspected":true,"hasReasoningContent":true,"reasoningChars":79,"promptTokens":2278,"cachedPromptTokens":0,"completionTokens":20,"totalTokens":2298,"reasoningTokens":14}}
```

### A
```
{"index":1,"at":"2026-07-19T12:24:05.242Z","url":"https://open.bigmodel.cn/api/coding/paas/v4/chat/completions","model":"glm-5.2","thinking":{"type":"enabled"},"temperature":0,"doSample":false,"compliant":true,"response":{"httpStatus":200,"inspected":true,"hasReasoningContent":true,"reasoningChars":91,"promptTokens":3489,"cachedPromptTokens":1856,"completionTokens":68,"totalTokens":3557,"reasoningTokens":18}}
```

### C
```
{"index":1,"at":"2026-07-19T12:24:36.040Z","url":"https://open.bigmodel.cn/api/coding/paas/v4/chat/completions","model":"glm-5.2","thinking":{"type":"enabled"},"temperature":0,"doSample":false,"compliant":true,"response":{"httpStatus":200,"inspected":true,"hasReasoningContent":true,"reasoningChars":97,"promptTokens":3530,"cachedPromptTokens":3264,"completionTokens":55,"totalTokens":3585,"reasoningTokens":18}}
```

## 说明

- 代理: 进程内 HTTP forward capture（目标 open.bigmodel.cn）；结束即关；临时 memory 已销毁。
- 正式题库未跑；本任务 `smoke-injection-live` 仅烟测。
