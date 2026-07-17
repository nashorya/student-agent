# J-space compaction recovery formal snapshot

Run ID: `2026-07-16T16-41-56-522Z`

## Result

- 6/6 formal runs completed (`plain` 3/3, `current` 3/3)
- 6/6 verifier scores were 1.0 and every named check passed
- 12/12 forced compaction boundaries completed through `AgentSession.compact`
- 12/12 boundary prompts were within the pinned 50k–80k target
- Thinking was observed in every run
- Every request used `glm-5.2`, `thinking=enabled`, `temperature=0`, and `do_sample=false`
- Arm isolation passed in every run; no reruns were required

## Per-run evidence

| Arm | Seed | Calls | Phase 2 tokens | Phase 4 tokens | Total tokens | Reasoning tokens | List-price equivalent |
|---|---:|---:|---:|---:|---:|---:|---:|
| plain | 1 | 17 | 57,811 | 61,831 | 890,784 | 3,509 | ¥2.651028 |
| plain | 2 | 19 | 58,214 | 60,060 | 1,000,805 | 1,188 | ¥3.109320 |
| plain | 3 | 20 | 57,469 | 60,410 | 1,061,187 | 1,678 | ¥2.923588 |
| current | 1 | 23 | 58,017 | 61,338 | 1,256,563 | 1,689 | ¥3.359508 |
| current | 2 | 18 | 58,187 | 59,903 | 947,974 | 1,593 | ¥2.678456 |
| current | 3 | 18 | 58,009 | 60,116 | 946,600 | 1,571 | ¥2.674304 |

## Arm comparison

| Metric | plain | current |
|---|---:|---:|
| Passed runs | 3/3 | 3/3 |
| Average model calls | 18.67 | 19.67 |
| Average Phase 2 boundary | 57,831 | 58,071 |
| Average Phase 4 boundary | 60,767 | 60,452 |
| Total tokens | 2,952,776 | 3,151,137 |
| Uncached prompt tokens | 388,496 | 333,732 |
| Completion tokens | 17,208 | 15,677 |
| List-price equivalent | ¥8.683936 | ¥8.712268 |

Both arms reached the verifier ceiling. The current arm used 6.7% more total tokens and
one extra model call per run on average, while using 14.1% fewer uncached prompt tokens
and 8.9% fewer completion tokens. Its list-price equivalent was only 0.3% higher.

Because the active endpoint was Coding Plan, the CNY values are public pay-as-you-go
equivalents, not the actual marginal subscription bill.

## Decision

The forced-compaction recovery baseline is valid and stable. This probe does not show a
quality advantage for the current context-runtime arm over plain Pi compaction. A harder
recovery task or an actual J-space intervention is needed to separate the arms; repeating
this same ceiling-level probe is unlikely to add information.
