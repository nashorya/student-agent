#!/usr/bin/env python3
"""Run the DeepSeek-backed benchmark comparison pipeline.

This orchestrates existing npm/Harbor/SWE-bench entrypoints. It intentionally
keeps provider defaults in one Python file so manual runs only need
DEEPSEEK_API_KEY plus optional flags.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from scripts.cache_claude_code_cli import ensure_claude_code_cache
except ModuleNotFoundError:  # pragma: no cover - direct script execution path.
    from cache_claude_code_cli import ensure_claude_code_cache


# Manual config for local benchmark runs. Fill these in directly if you do not
# want to export keys/base URLs in the shell. Leave keys empty to use env vars.
CLAUDE_CODE_API_KEY = "REDACTED_SECRET"
STUDENT_AGENT_API_KEY = "REDACTED_SECRET"
CLAUDE_CODE_BASE_URL = "https://api.muskapi.cc"
STUDENT_AGENT_BASE_URL = "https://api.muskapi.cc/v1"
CLAUDE_CODE_MODEL = "gpt-5.5"
STUDENT_AGENT_MODEL = "gpt-5.5"
FLASH_MODEL = "gpt-5.5"
PRICE_CURRENCY = "CNY"
CLAUDE_CODE_INPUT_PRICE_PER_MILLION = 1.0
CLAUDE_CODE_OUTPUT_PRICE_PER_MILLION = 6.0
STUDENT_AGENT_INPUT_PRICE_PER_MILLION = 1.0
STUDENT_AGENT_OUTPUT_PRICE_PER_MILLION = 6.0
ANTHROPIC_PRICE_CURRENCY = "USD"
ANTHROPIC_SONNET_INPUT_PRICE_PER_MILLION = 3.0
ANTHROPIC_SONNET_OUTPUT_PRICE_PER_MILLION = 15.0
ANTHROPIC_SONNET_CACHE_READ_PRICE_PER_MILLION = 0.30
ANTHROPIC_SONNET_CACHE_WRITE_5M_PRICE_PER_MILLION = 3.75
ANTHROPIC_SONNET_CACHE_WRITE_1H_PRICE_PER_MILLION = 6.0

DEFAULT_MODEL = CLAUDE_CODE_MODEL
DEFAULT_FLASH_MODEL = FLASH_MODEL
DEFAULT_SWE_INSTANCES = Path("evals/inputs/swebench-lite-2.jsonl")
DEFAULT_SWE_LIMIT = 2
DEFAULT_SWEBENCH_VENV_PYTHON = Path("/tmp/swebench-harness-venv/bin/python")
DEFAULT_TERMINAL_PATH = Path("$HOME/.cache/harbor/tasks/kzqjKVWxvHZxV5xyLNLqJi")
DEFAULT_TERMINAL_DATASET = "terminal-bench@2.0"
DEFAULT_TERMINAL_TASKS = [
    "overfull-hbox",
    "cobol-modernization",
    "fix-git",
    "prove-plus-comm",
    "modernize-scientific-stack",
]
DEFAULT_CLAUDE_CODE_CACHED_VERSION = os.environ.get("CLAUDE_CODE_CACHED_VERSION", "2.1.172")
DEFAULT_CLAUDE_CODE_CACHE_DIR = Path.home() / ".cache" / "student-agent" / "claude-code"
DEFAULT_CLAUDE_CODE_CACHE_MOUNT = "/mnt/claude-code"
DEFAULT_TERMINAL_INSTALL_COMMAND = (
    "rm -rf /tmp/student-agent && mkdir -p /tmp/student-agent && "
    "tar --exclude=node_modules --exclude=.git --exclude=evals/results "
    "-C /mnt/student-agent -cf - . | tar -C /tmp/student-agent -xf - && "
    "cd /tmp/student-agent && rm -f package-lock.json && "
    "npm install --registry=https://registry.npmjs.org "
    "--fetch-retries=5 --fetch-retry-mintimeout=20000 "
    "--fetch-retry-maxtimeout=120000 && npm run build"
)


@dataclass(frozen=True)
class RunStep:
    name: str
    command: list[str]
    env_overrides: dict[str, str] | None = None
    cwd: Path | None = None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = Path(__file__).resolve().parents[1]
    run_id = args.run_id or timestamp()
    output_root = repo_root / "evals" / "results" / "comparison" / run_id
    output_root.mkdir(parents=True, exist_ok=True)
    write_run_metadata(
        output_root,
        run_id=run_id,
        repo_root=repo_root,
        claude_model=args.claude_model,
        student_model=args.student_model,
        provider_env=args.provider_env,
    )

    try:
        env = build_benchmark_env(
            os.environ,
            provider_env=args.provider_env,
            claude_model=args.claude_model,
            student_model=args.student_model,
            flash_model=args.flash_model,
        )
    except ValueError as err:
        print(f"[comparison] {err}", file=sys.stderr)
        return 2

    env["COMPARISON_OUTPUT_ROOT"] = str(output_root)
    set_optional_env(env, "HTTP_PROXY", args.http_proxy)
    set_optional_env(env, "HTTPS_PROXY", args.https_proxy)
    env.pop("ALL_PROXY", None)
    env.pop("all_proxy", None)

    terminal_tasks = parse_tasks(args.terminal_tasks)
    if terminal_tasks and not args.dry_run and not args.skip_claude_code_cache_download:
        cached_cli = ensure_claude_code_cache(
            cache_dir=args.claude_code_cache_dir,
            version=args.claude_code_version,
        )
        print(f"[comparison] Claude Code CLI cache {cached_cli}")
    plan = build_run_plan(
        swe_instances=args.swe_instances,
        swe_limit=args.swe_limit,
        terminal_tasks=terminal_tasks,
        claude_model=args.claude_model,
        student_model=args.student_model,
        repo_root=repo_root,
        output_root=output_root,
        run_swe_harness=not args.skip_swe_harness,
        swe_python=args.swe_python,
        swe_dataset=args.swe_dataset,
        terminal_path=None if args.terminal_dataset else args.terminal_path,
        terminal_dataset=args.terminal_dataset or DEFAULT_TERMINAL_DATASET,
        claude_code_cache_dir=args.claude_code_cache_dir,
        claude_code_cache_mount=DEFAULT_CLAUDE_CODE_CACHE_MOUNT,
    )

    write_plan(output_root / "plan.json", plan)
    if args.dry_run:
        print(json.dumps({
            "ok": True,
            "dry_run": True,
            "output_root": str(output_root),
            "steps": [{"name": step.name, "command": step.command} for step in plan],
        }, indent=2))
        return 0

    for step in plan:
        code = run_step(step, env=env, cwd=repo_root, log_dir=output_root / "logs")
        if code != 0 and not args.keep_going:
            write_report(output_root, run_id, terminal_tasks)
            return code

    write_report(output_root, run_id, terminal_tasks)
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run CC vs student-agent benchmark comparison.")
    parser.add_argument("--model", help="Use the same model for Claude Code and student-agent.")
    parser.add_argument("--claude-model", default=CLAUDE_CODE_MODEL)
    parser.add_argument("--student-model", default=STUDENT_AGENT_MODEL)
    parser.add_argument("--flash-model", default=FLASH_MODEL)
    parser.add_argument(
        "--provider-env",
        choices=["manual", "native-anthropic"],
        default="manual",
        help=(
            "manual uses the Python manual config block; native-anthropic "
            "requires ANTHROPIC_API_KEY and avoids proxy/base-url overrides."
        ),
    )
    parser.add_argument("--swe-instances", type=Path, default=DEFAULT_SWE_INSTANCES)
    parser.add_argument("--swe-limit", type=int, default=DEFAULT_SWE_LIMIT)
    parser.add_argument("--swe-dataset", default="SWE-bench/SWE-bench_Lite")
    parser.add_argument("--swe-python", default=default_swe_python())
    parser.add_argument("--skip-swe-harness", action="store_true")
    parser.add_argument("--terminal-path", type=Path, default=DEFAULT_TERMINAL_PATH)
    parser.add_argument(
        "--terminal-dataset",
        help="Use a Harbor registry dataset instead of the local --terminal-path.",
    )
    parser.add_argument("--terminal-tasks", default=",".join(DEFAULT_TERMINAL_TASKS))
    parser.add_argument("--claude-code-version", default=DEFAULT_CLAUDE_CODE_CACHED_VERSION)
    parser.add_argument("--claude-code-cache-dir", type=Path, default=DEFAULT_CLAUDE_CODE_CACHE_DIR)
    parser.add_argument("--skip-claude-code-cache-download", action="store_true")
    parser.add_argument("--run-id")
    parser.add_argument("--http-proxy", default="")
    parser.add_argument("--https-proxy", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--keep-going", action="store_true")
    args = parser.parse_args(argv)
    if args.model:
        args.claude_model = args.model
        args.student_model = args.model
    if args.swe_limit <= 0:
        parser.error("--swe-limit must be a positive integer")
    return args


def build_deepseek_env(
    base_env: dict[str, str],
    *,
    model: str | None = None,
    claude_model: str | None = None,
    student_model: str | None = None,
    flash_model: str = FLASH_MODEL,
) -> dict[str, str]:
    claude_model = claude_model or model or CLAUDE_CODE_MODEL
    student_model = student_model or model or STUDENT_AGENT_MODEL
    claude_key = first_non_empty(
        CLAUDE_CODE_API_KEY,
        base_env.get("ANTHROPIC_AUTH_TOKEN"),
        base_env.get("DEEPSEEK_API_KEY"),
        STUDENT_AGENT_API_KEY,
    )
    student_key = first_non_empty(
        STUDENT_AGENT_API_KEY,
        base_env.get("DEEPSEEK_API_KEY"),
        base_env.get("ANTHROPIC_AUTH_TOKEN"),
        CLAUDE_CODE_API_KEY,
    )
    if not claude_key or not student_key:
        raise ValueError(
            "Set CLAUDE_CODE_API_KEY/STUDENT_AGENT_API_KEY in scripts/run_benchmark_comparison.py "
            "or export DEEPSEEK_API_KEY before running comparison."
        )
    env = dict(base_env)
    env.update({
        "DEEPSEEK_API_KEY": student_key,
        "ANTHROPIC_AUTH_TOKEN": claude_key,
        "ANTHROPIC_BASE_URL": first_non_empty(CLAUDE_CODE_BASE_URL, base_env.get("ANTHROPIC_BASE_URL")),
        "ANTHROPIC_MODEL": claude_model,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": claude_model,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": claude_model,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": flash_model,
        "CLAUDE_CODE_SUBAGENT_MODEL": flash_model,
        "CLAUDE_CODE_EFFORT_LEVEL": "max",
        "STUDENT_AGENT_PROVIDER": "deepseek",
        "STUDENT_AGENT_API": "openai-completions",
        "STUDENT_AGENT_BASE_URL": first_non_empty(STUDENT_AGENT_BASE_URL, base_env.get("STUDENT_AGENT_BASE_URL")),
        "STUDENT_AGENT_MODEL": student_model,
        "STUDENT_AGENT_EXECUTION_MODE": "yolo",
        "STUDENT_AGENT_SUPPRESS_EMBEDDING_REMINDER": "1",
    })
    env.pop("OPENAI_BASE_URL", None)
    return env


def build_benchmark_env(
    base_env: dict[str, str],
    *,
    provider_env: str = "manual",
    model: str | None = None,
    claude_model: str | None = None,
    student_model: str | None = None,
    flash_model: str = FLASH_MODEL,
) -> dict[str, str]:
    if provider_env == "manual":
        return build_deepseek_env(
            base_env,
            model=model,
            claude_model=claude_model,
            student_model=student_model,
            flash_model=flash_model,
        )
    if provider_env == "native-anthropic":
        return build_native_anthropic_env(
            base_env,
            model=model,
            claude_model=claude_model,
            student_model=student_model,
            flash_model=flash_model,
        )
    raise ValueError(f"Unsupported provider env: {provider_env}")


def build_native_anthropic_env(
    base_env: dict[str, str],
    *,
    model: str | None = None,
    claude_model: str | None = None,
    student_model: str | None = None,
    flash_model: str | None = None,
) -> dict[str, str]:
    claude_model = claude_model or model or "claude-sonnet-4-6"
    student_model = student_model or model or claude_model
    flash_model = flash_model or claude_model
    api_key = first_non_empty(
        base_env.get("ANTHROPIC_API_KEY"),
        base_env.get("ANTHROPIC_AUTH_TOKEN"),
    )
    if not api_key:
        raise ValueError("Export ANTHROPIC_API_KEY before running --provider-env native-anthropic.")

    env = dict(base_env)
    env.update({
        "ANTHROPIC_API_KEY": api_key,
        "ANTHROPIC_AUTH_TOKEN": api_key,
        "ANTHROPIC_MODEL": claude_model,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": claude_model,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": claude_model,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": flash_model,
        "CLAUDE_CODE_SUBAGENT_MODEL": flash_model,
        "CLAUDE_CODE_EFFORT_LEVEL": "max",
        "STUDENT_AGENT_PROVIDER": "anthropic",
        "STUDENT_AGENT_API": "anthropic-messages",
        "STUDENT_AGENT_MODEL": student_model,
        "STUDENT_AGENT_EXECUTION_MODE": "yolo",
        "STUDENT_AGENT_SUPPRESS_EMBEDDING_REMINDER": "1",
    })
    for key in [
        "ANTHROPIC_BASE_URL",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
        "DEEPSEEK_API_KEY",
        "STUDENT_AGENT_BASE_URL",
        "STUDENT_AGENT_MODEL_BASE_URL",
    ]:
        env.pop(key, None)
    return env


def first_non_empty(*values: str | None) -> str:
    return next((value for value in values if value), "")


def set_optional_env(env: dict[str, str], key: str, value: str) -> None:
    if value:
        env[key] = value
    else:
        env.pop(key, None)


def default_swe_python() -> str:
    if DEFAULT_SWEBENCH_VENV_PYTHON.exists():
        return str(DEFAULT_SWEBENCH_VENV_PYTHON)
    return shutil.which("python3") or "python3"


def build_run_plan(
    *,
    swe_instances: Path,
    swe_limit: int = DEFAULT_SWE_LIMIT,
    terminal_tasks: list[str],
    model: str | None = None,
    claude_model: str | None = None,
    student_model: str | None = None,
    repo_root: Path | None = None,
    output_root: Path | None = None,
    run_swe_harness: bool = True,
    swe_python: str = "python3",
    swe_dataset: str = "SWE-bench/SWE-bench_Lite",
    terminal_path: Path | None = DEFAULT_TERMINAL_PATH,
    terminal_dataset: str = DEFAULT_TERMINAL_DATASET,
    claude_code_cache_dir: Path = DEFAULT_CLAUDE_CODE_CACHE_DIR,
    claude_code_cache_mount: str = DEFAULT_CLAUDE_CODE_CACHE_MOUNT,
) -> list[RunStep]:
    claude_model = claude_model or model or CLAUDE_CODE_MODEL
    student_model = student_model or model or STUDENT_AGENT_MODEL
    repo_root = repo_root or Path.cwd()
    output_root = output_root or Path("evals/results/comparison/dry-run")
    swe_cc = output_root / "swe-claude-code"
    swe_student = output_root / "swe-student-agent"
    terminal_cc = output_root / "terminal-claude-code"
    terminal_student = output_root / "terminal-student-agent"
    steps = [
        RunStep(
            "swe-produce-claude-code",
            [
                "npm", "run", "eval:swebench:produce", "--",
                "--instances-path", str(swe_instances),
                "--agent", "claude-code",
                "--limit", str(swe_limit),
                "--output-dir", str(swe_cc),
                "--claude-model", claude_model,
                "--claude-max-budget-usd", "3",
                "--timeout-seconds", "1800",
            ],
        ),
        RunStep(
            "swe-produce-student-agent",
            [
                "npm", "run", "eval:swebench:produce", "--",
                "--instances-path", str(swe_instances),
                "--agent", "student-agent",
                "--limit", str(swe_limit),
                "--output-dir", str(swe_student),
                "--model-name", f"student-agent-{student_model}",
                "--student-variant", "context_runtime",
                "--timeout-seconds", "1800",
            ],
            env_overrides={
                "HOME": str(Path(tempfile.gettempdir()) / "student-agent-swe-comparison-home"),
                "NPM_CONFIG_CACHE": str(Path.home() / ".npm"),
            },
        ),
    ]
    if run_swe_harness:
        harness_id_base = safe_run_id(output_root.name)
        for agent_name, predictions_dir in [
            ("claude-code", swe_cc),
            ("student-agent", swe_student),
        ]:
            steps.append(RunStep(
                f"swe-harness-{agent_name}",
                [
                    swe_python, "-m", "swebench.harness.run_evaluation",
                    "-d", swe_dataset,
                    "-s", "test",
                    "-p", str(predictions_dir / "predictions.jsonl"),
                    "--max_workers", "1",
                    "-id", f"{harness_id_base}-{agent_name}",
                    "--report_dir", str(output_root / "swe-harness-reports"),
                ],
                cwd=output_root,
            ))

    terminal_args = terminal_include_args(terminal_tasks)
    terminal_source_args = (
        ["--path", str(terminal_path)]
        if terminal_path
        else ["--dataset", terminal_dataset]
    )
    claude_code_mounts = harbor_bind_mounts([
        {
            "type": "bind",
            "source": str(claude_code_cache_dir),
            "target": claude_code_cache_mount,
            "read_only": True,
        },
    ])
    student_agent_mounts = harbor_bind_mounts([
        {
            "type": "bind",
            "source": str(repo_root),
            "target": "/mnt/student-agent",
            "read_only": True,
        },
    ])
    steps.extend([
        RunStep(
            "terminal-bench-claude-code",
            [
                "npm", "run", "eval:terminal-bench", "--",
                *terminal_source_args,
                "--agent-import-path", "benchmarks.terminal_bench.claude_code_cached:ClaudeCodeCached",
                "--model", claude_model,
                "--n-concurrent", "1",
                "--agent-setup-timeout-multiplier", "3",
                "--n-tasks", str(len(terminal_tasks)),
                "--output-dir", str(terminal_cc),
                "--",
                "--mounts", claude_code_mounts,
                *terminal_args,
            ],
            env_overrides={
                "CLAUDE_CODE_CACHE_MOUNT": claude_code_cache_mount,
            },
        ),
        RunStep(
            "terminal-bench-student-agent",
            [
                "npm", "run", "eval:terminal-bench", "--",
                *terminal_source_args,
                "--agent-import-path", "benchmarks.terminal_bench.student_agent:StudentAgent",
                "--model", student_model,
                "--n-concurrent", "1",
                "--agent-setup-timeout-multiplier", "3",
                "--n-tasks", str(len(terminal_tasks)),
                "--output-dir", str(terminal_student),
                "--",
                "--mounts", student_agent_mounts,
                *terminal_args,
            ],
            env_overrides={
                "STUDENT_AGENT_HARBOR_INSTALL_COMMAND": DEFAULT_TERMINAL_INSTALL_COMMAND,
            },
        ),
    ])
    return steps


def harbor_bind_mounts(mounts: list[dict[str, Any]]) -> str:
    return json.dumps(mounts, separators=(",", ":"))


def terminal_include_args(tasks: list[str]) -> list[str]:
    args: list[str] = []
    for task in tasks:
        args.extend(["--include-task-name", task])
    return args


def parse_tasks(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def run_step(step: RunStep, *, env: dict[str, str], cwd: Path, log_dir: Path) -> int:
    log_dir.mkdir(parents=True, exist_ok=True)
    step_env = dict(env)
    if step.env_overrides:
        step_env.update(step.env_overrides)
    log_path = log_dir / f"{step.name}.log"
    print(f"[comparison] running {step.name}")
    print(f"[comparison] log {log_path}")
    with log_path.open("w", encoding="utf-8") as log:
        log.write("$ " + " ".join(step.command) + "\n")
        log.flush()
        proc = subprocess.Popen(
            step.command,
            cwd=step.cwd or cwd,
            env=step_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            print(line, end="")
            log.write(line)
        return proc.wait()


def write_plan(path: Path, plan: list[RunStep]) -> None:
    path.write_text(json.dumps([
        {
            "name": step.name,
            "command": step.command,
            "env_overrides": step.env_overrides or {},
            "cwd": str(step.cwd) if step.cwd else None,
        }
        for step in plan
    ], indent=2), encoding="utf-8")


def summarize_terminal_result(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    stats = data.get("stats", {})
    evals = stats.get("evals") or {}
    eval_summary = next(iter(evals.values()), {})
    rewards = ((eval_summary.get("reward_stats") or {}).get("reward") or {})
    exceptions = eval_summary.get("exception_stats") or {}
    invalid_reasons = invalid_terminal_trials(path, rewards, exceptions)
    invalid_trial_ids = set(invalid_reasons)
    passed_trials = [trial for trial in rewards.get("1.0", []) if trial not in invalid_trial_ids]
    failed_trials = [trial for trial in rewards.get("0.0", []) if trial not in invalid_trial_ids]
    raw_mean = ((eval_summary.get("metrics") or [{}])[0]).get("mean")
    valid_reward_trials = len(passed_trials) + len(failed_trials)
    mean = raw_mean
    if invalid_trial_ids:
        mean = (len(passed_trials) / valid_reward_trials) if valid_reward_trials else None
    return {
        "path": str(path),
        "completed": stats.get("n_completed_trials"),
        "errored": stats.get("n_errored_trials"),
        "n_trials": eval_summary.get("n_trials"),
        "n_errors": eval_summary.get("n_errors"),
        "mean": mean,
        "rawMean": raw_mean,
        "validRewardTrials": valid_reward_trials,
        "invalid_run": bool(invalid_trial_ids),
        "invalid_runs": strip_trial_ids(sorted(invalid_trial_ids)),
        "invalid_reasons": {
            strip_trial_ids([trial])[0]: reasons
            for trial, reasons in sorted(invalid_reasons.items())
        },
        "pass": strip_trial_ids(passed_trials),
        "fail": strip_trial_ids(failed_trials),
        "exceptions": {key: strip_trial_ids(value) for key, value in exceptions.items()},
        "tokens": {
            "input": stats.get("n_input_tokens"),
            "cache": stats.get("n_cache_tokens"),
            "output": stats.get("n_output_tokens"),
            "costUsd": stats.get("cost_usd"),
        },
    }


def summarize_terminal_student_agent_tokens(run_root: Path) -> dict[str, Any]:
    totals = {
        "input": 0,
        "cache": 0,
        "output": 0,
        "total": 0,
        "costUsd": 0.0,
        "turns": 0,
        "guardRuleCounts": {},
        "runs": [],
        "summaryFiles": 0,
        "contextEffect": {
            "observedInputTokens": 0,
            "classifiedInputTokens": 0,
            "unclassifiedInputTokens": 0,
            "layers": {"L0": 0, "L1": 0, "L2": 0, "L3": 0},
        },
    }
    for summary_path in sorted(run_root.glob("*/agent/student-agent-summary.json")):
        data = json.loads(summary_path.read_text(encoding="utf-8"))
        usage = data.get("tokenUsage") or {}
        cost = usage.get("costUsd") or data.get("cost") or {}
        guard_counts = data.get("guardRuleCounts") or {}
        task = strip_trial_ids([summary_path.parent.parent.name])[0]
        totals["input"] += int(usage.get("inputTokens") or 0)
        totals["cache"] += int(usage.get("cacheReadTokens") or 0)
        totals["output"] += int(usage.get("outputTokens") or 0)
        totals["total"] += int(usage.get("totalTokens") or 0)
        totals["costUsd"] += float(cost.get("total") or 0)
        totals["turns"] += int(data.get("turnCount") or 0)
        for rule_name, count in guard_counts.items():
            count = int(count or 0)
            if count > 0:
                totals["guardRuleCounts"][rule_name] = (
                    totals["guardRuleCounts"].get(rule_name, 0) + count
                )
        totals["runs"].append({
            "task": task,
            "turns": int(data.get("turnCount") or 0),
            "input": int(usage.get("inputTokens") or 0),
            "cache": int(usage.get("cacheReadTokens") or 0),
            "output": int(usage.get("outputTokens") or 0),
            "total": int(usage.get("totalTokens") or 0),
            "costUsd": float(cost.get("total") or 0),
            "guardRuleCounts": guard_counts,
        })
        totals["summaryFiles"] += 1
        add_context_effect(totals["contextEffect"], data.get("contextTokenEffect") or {})
    return totals


def add_context_effect(target: dict[str, Any], effect: dict[str, Any]) -> None:
    target["observedInputTokens"] += int(effect.get("observedInputTokens") or 0)
    target["classifiedInputTokens"] += int(effect.get("classifiedInputTokens") or 0)
    target["unclassifiedInputTokens"] += int(effect.get("unclassifiedInputTokens") or 0)
    layers = effect.get("layers") or {}
    for layer in ["L0", "L1", "L2", "L3"]:
        layer_data = layers.get(layer) or {}
        target["layers"][layer] += int(layer_data.get("estimatedTokens") or 0)


def summarize_swe_harness_report(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "path": str(path),
        "submitted": data.get("submitted_instances"),
        "completed": data.get("completed_instances"),
        "resolved": data.get("resolved_instances"),
        "unresolved": data.get("unresolved_instances"),
        "emptyPatches": data.get("empty_patch_instances"),
        "errors": data.get("error_instances"),
        "resolvedIds": data.get("resolved_ids") or [],
        "errorIds": data.get("error_ids") or [],
    }


def strip_trial_ids(values: list[str]) -> list[str]:
    return [value.split("__", 1)[0] for value in values]


def nonzero_agent_exit_trials(result_path: Path, exceptions: dict[str, list[str]]) -> list[str]:
    invalid_trials: list[str] = []
    for trial in exceptions.get("NonZeroAgentExitCodeError") or []:
        exception_path = result_path.parent / trial / "exception.txt"
        exception_text = ""
        if exception_path.exists():
            exception_text = exception_path.read_text(encoding="utf-8", errors="replace")
        if not exception_text or "Command failed (exit " in exception_text:
            invalid_trials.append(trial)
    return invalid_trials


def invalid_terminal_trials(
    result_path: Path,
    rewards: dict[str, list[str]],
    exceptions: dict[str, list[str]],
) -> dict[str, list[str]]:
    invalid: dict[str, list[str]] = {}
    for trial in nonzero_agent_exit_trials(result_path, exceptions):
        invalid.setdefault(trial, []).append("agent_nonzero_exit")
    for trial in exceptions.get("AgentTimeoutError") or []:
        invalid.setdefault(trial, []).append("agent_timeout")
    for trial in rewards.get("0.0", []) or []:
        if verifier_setup_failed(result_path.parent / trial):
            invalid.setdefault(trial, []).append("verifier_setup_failure")
    return invalid


VERIFIER_SETUP_FAILURE_PATTERNS = [
    "astral.sh",
    "uvx: command not found",
    "/root/.local/bin/env: No such file or directory",
    "SSL_connect",
    "Could not resolve host",
    "Connection timed out",
    "Temporary failure resolving",
]


def verifier_setup_failed(trial_root: Path) -> bool:
    verifier_dir = trial_root / "verifier"
    for name in ["test-stdout.txt", "test-stderr.txt"]:
        log_path = verifier_dir / name
        if not log_path.exists():
            continue
        text = log_path.read_text(encoding="utf-8", errors="replace")
        if any(pattern in text for pattern in VERIFIER_SETUP_FAILURE_PATTERNS):
            return True
    return False


def write_report(output_root: Path, run_id: str, terminal_tasks: list[str]) -> None:
    summary = {
        "runId": run_id,
        "outputRoot": str(output_root),
        "terminalTasks": terminal_tasks,
        "terminal": {},
        "swe": {},
        "sweHarness": {},
        "metadata": load_json_if_exists(output_root / "metadata.json"),
    }
    terminal_roots = {
        "claudeCode": output_root / "terminal-claude-code",
        "studentAgent": output_root / "terminal-student-agent",
    }
    for key, root in terminal_roots.items():
        result = newest_result(root)
        if result:
            item = summarize_terminal_result(result)
            if key == "studentAgent":
                student_tokens = summarize_terminal_student_agent_tokens(result.parent)
                if student_tokens["summaryFiles"]:
                    item["studentAgentTokens"] = student_tokens
            summary["terminal"][key] = item

    for key, root in {
        "claudeCode": output_root / "swe-claude-code",
        "studentAgent": output_root / "swe-student-agent",
    }.items():
        records = root / "records.json"
        if records.exists():
            summary["swe"][key] = json.loads(records.read_text(encoding="utf-8"))

    for key in ["claudeCode", "studentAgent"]:
        report = newest_swe_harness_report(output_root, key)
        if report:
            summary["sweHarness"][key] = summarize_swe_harness_report(report)

    summary_path = output_root / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    md_path = output_root / "summary.md"
    md_path.write_text(render_markdown_summary(summary), encoding="utf-8")
    print(f"[comparison] summary {summary_path}")
    print(f"[comparison] markdown {md_path}")


def newest_result(root: Path) -> Path | None:
    matches = sorted(root.glob("*/result.json"), key=lambda path: path.stat().st_mtime if path.exists() else 0)
    return matches[-1] if matches else None


def newest_swe_harness_report(output_root: Path, key: str) -> Path | None:
    prefixes = ["claude-code."] if key == "claudeCode" else ["student-agent"]
    candidates = []
    for base in [output_root, output_root / "swe-harness-reports"]:
        if base.exists():
            candidates.extend(
                path for path in base.glob("*.json")
                if any(path.name.startswith(prefix) for prefix in prefixes)
            )
    matches = sorted(candidates, key=lambda path: path.stat().st_mtime if path.exists() else 0)
    return matches[-1] if matches else None


def render_markdown_summary(summary: dict[str, Any]) -> str:
    lines = [
        f"# Benchmark Comparison {summary['runId']}",
        "",
        f"Output root: `{summary['outputRoot']}`",
        f"Git commit: `{(summary.get('metadata') or {}).get('gitCommit', 'unknown')}`",
        "",
        "## Terminal-Bench",
        "",
        "| Agent | Mean | Trials | Errors | Invalid Runs | Pass | Fail | Exceptions | Cost |",
        "|---|---:|---:|---:|---|---|---|---|---:|",
    ]
    for label, key in [("Claude Code", "claudeCode"), ("student-agent", "studentAgent")]:
        item = summary.get("terminal", {}).get(key, {})
        token_summary = item.get("studentAgentTokens") or item.get("tokens") or {}
        lines.append(
            "| "
            + " | ".join([
                label,
                format_value(item.get("mean")),
                format_value(item.get("n_trials")),
                format_value(item.get("n_errors")),
                ", ".join(item.get("invalid_runs", [])),
                ", ".join(item.get("pass", [])),
                ", ".join(item.get("fail", [])),
                "; ".join(f"{name}: {', '.join(tasks)}" for name, tasks in (item.get("exceptions") or {}).items()),
                format_value(token_summary.get("costUsd")),
            ])
            + " |"
        )
    student_context = (
        ((summary.get("terminal", {}).get("studentAgent", {}) or {}).get("studentAgentTokens") or {})
        .get("contextEffect")
    )
    if student_context and student_context.get("observedInputTokens"):
        lines.extend([
            "",
            "### student-agent Context Effect",
            "",
            "| Scope | Estimated Tokens |",
            "|---|---:|",
        ])
        layers = student_context.get("layers") or {}
        for layer in ["L0", "L1", "L2", "L3"]:
            lines.append(f"| {layer} | {format_value(layers.get(layer))} |")
        lines.extend([
            f"| Classified input | {format_value(student_context.get('classifiedInputTokens'))} |",
            f"| Unclassified input | {format_value(student_context.get('unclassifiedInputTokens'))} |",
            f"| Observed input | {format_value(student_context.get('observedInputTokens'))} |",
        ])
    lines.extend(["", "## SWE-bench", ""])
    harness = summary.get("sweHarness", {}) or {}
    if harness:
        lines.extend([
            "### Official Harness",
            "",
            "| Agent | Submitted | Completed | Resolved | Empty Patches | Errors |",
            "|---|---:|---:|---:|---:|---:|",
        ])
        for label, key in [("Claude Code", "claudeCode"), ("student-agent", "studentAgent")]:
            item = harness.get(key, {})
            lines.append(
                "| "
                + " | ".join([
                    label,
                    format_value(item.get("submitted")),
                    format_value(item.get("completed")),
                    format_value(item.get("resolved")),
                    format_value(item.get("emptyPatches")),
                    format_value(item.get("errors")),
                ])
                + " |"
            )
        lines.extend(["", "### Producer", ""])
    for label, key in [("Claude Code", "claudeCode"), ("student-agent", "studentAgent")]:
        records = (summary.get("swe", {}).get(key, {}) or {}).get("records", [])
        if not records:
            continue
        record = records[0]
        analysis = record.get("patchAnalysis") or {}
        lines.append(
            f"- {label}: `{record.get('status')}`, patch bytes "
            f"{len((record.get('prediction') or {}).get('model_patch', '').encode())}, "
            f"duration {record.get('durationMs')} ms, "
            f"empty={format_value(record.get('emptyPatch') or analysis.get('emptyPatch'))}, "
            f"suspicious={format_value(record.get('suspiciousPatch') or analysis.get('suspiciousPatch'))}, "
            f"variant={record.get('studentVariant') or 'n/a'}"
        )
        context_effect = ((record.get("trace") or {}).get("contextTokenEffect") or {})
        if context_effect:
            layers = context_effect.get("layers") or {}
            lines.append(
                "  - context tokens: "
                + ", ".join(
                    f"{layer}={format_value((layers.get(layer) or {}).get('estimatedTokens'))}"
                    for layer in ["L0", "L1", "L2", "L3"]
                )
                + f", observed input={format_value(context_effect.get('observedInputTokens'))}"
            )
    lines.append("")
    return "\n".join(lines)


def format_value(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, float):
        return f"{value:.6g}"
    return str(value)


def timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def safe_run_id(value: str) -> str:
    return "".join(char if char.isalnum() or char in "._-" else "-" for char in value) or "comparison-swe"


def load_json_if_exists(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_run_metadata(
    output_root: Path,
    *,
    run_id: str,
    repo_root: Path,
    claude_model: str,
    student_model: str,
    provider_env: str = "manual",
) -> None:
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    ).stdout.strip() or "unknown"
    pricing = (
        anthropic_pricing(claude_model=claude_model, student_model=student_model)
        if provider_env == "native-anthropic"
        else manual_pricing(claude_model=claude_model, student_model=student_model)
    )
    metadata = {
        "runId": run_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "gitCommit": commit,
        "studentVariant": "context_runtime",
        "providerEnv": provider_env,
        "pricing": pricing,
    }
    (output_root / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def manual_pricing(*, claude_model: str, student_model: str) -> dict[str, Any]:
    return {
        "currency": PRICE_CURRENCY,
        "unit": "per_million_tokens",
        "claudeCode": {
            "model": claude_model,
            "input": CLAUDE_CODE_INPUT_PRICE_PER_MILLION,
            "output": CLAUDE_CODE_OUTPUT_PRICE_PER_MILLION,
        },
        "studentAgent": {
            "model": student_model,
            "input": STUDENT_AGENT_INPUT_PRICE_PER_MILLION,
            "output": STUDENT_AGENT_OUTPUT_PRICE_PER_MILLION,
        },
    }


def anthropic_pricing(*, claude_model: str, student_model: str) -> dict[str, Any]:
    return {
        "currency": ANTHROPIC_PRICE_CURRENCY,
        "unit": "per_million_tokens",
        "source": "https://docs.anthropic.com/en/docs/about-claude/pricing",
        "claudeCode": anthropic_sonnet_pricing(claude_model),
        "studentAgent": anthropic_sonnet_pricing(student_model),
    }


def anthropic_sonnet_pricing(model: str) -> dict[str, Any]:
    return {
        "model": model,
        "input": ANTHROPIC_SONNET_INPUT_PRICE_PER_MILLION,
        "output": ANTHROPIC_SONNET_OUTPUT_PRICE_PER_MILLION,
        "cacheRead": ANTHROPIC_SONNET_CACHE_READ_PRICE_PER_MILLION,
        "cacheWrite5m": ANTHROPIC_SONNET_CACHE_WRITE_5M_PRICE_PER_MILLION,
        "cacheWrite1h": ANTHROPIC_SONNET_CACHE_WRITE_1H_PRICE_PER_MILLION,
    }


if __name__ == "__main__":
    raise SystemExit(main())
