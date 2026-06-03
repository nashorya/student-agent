# Product Rubric Calibration

Use this after baseline traces exist.

## Purpose

The agent can draft metrics, but product judgment decides what "good" means. Do not set hard thresholds or scorer weights before reviewing real transcripts and failed tasks.

## Calibration Questions

- Which failures are P0 unacceptable?
- Which failures are P1 major usability issues?
- Which failures are P2 tolerable but worth improving?
- How autonomous should the agent be before asking the user?
- How strict should bash restrictions be?
- How small should task phases be?
- When is speed more important than safety?
- When is safety more important than speed?
- Which behavior findings should become hard gates?

## Output Format

```text
P0:
- Failure:
- Why it matters:
- Required prevention:

P1:
- Failure:
- Expected improvement:

P2:
- Failure:
- Monitor only / later improvement:

Defaults:
- Bash:
- Edit/write:
- Task granularity:
- User confirmation:
- Eval gate:
```

## Rule

After product calibration, update the eval scorer and decision matrix. Then implement tool/task changes and compare against baseline.
