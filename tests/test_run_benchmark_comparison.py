import json
import tempfile
import unittest
from pathlib import Path

import scripts.run_benchmark_comparison as comparison
from scripts.run_benchmark_comparison import (
    DEFAULT_SWE_INSTANCES,
    DEFAULT_SWE_LIMIT,
    DEFAULT_TERMINAL_PATH,
    DEFAULT_TERMINAL_TASKS,
    build_benchmark_env,
    build_deepseek_env,
    build_native_anthropic_env,
    build_run_plan,
    default_swe_python,
    summarize_swe_harness_report,
    summarize_terminal_result,
    summarize_terminal_student_agent_tokens,
    newest_swe_harness_report,
    write_run_metadata,
)


class BenchmarkComparisonScriptTests(unittest.TestCase):
    def test_deepseek_env_sets_both_agent_lanes(self) -> None:
        original = (
            comparison.CLAUDE_CODE_API_KEY,
            comparison.STUDENT_AGENT_API_KEY,
            comparison.CLAUDE_CODE_BASE_URL,
            comparison.STUDENT_AGENT_BASE_URL,
        )
        comparison.CLAUDE_CODE_API_KEY = ""
        comparison.STUDENT_AGENT_API_KEY = ""
        comparison.CLAUDE_CODE_BASE_URL = "https://api.deepseek.com/anthropic"
        comparison.STUDENT_AGENT_BASE_URL = "https://api.deepseek.com"
        try:
            env = build_deepseek_env({"DEEPSEEK_API_KEY": "sk-test"}, model="deepseek-v4-pro")
        finally:
            (
                comparison.CLAUDE_CODE_API_KEY,
                comparison.STUDENT_AGENT_API_KEY,
                comparison.CLAUDE_CODE_BASE_URL,
                comparison.STUDENT_AGENT_BASE_URL,
            ) = original

        self.assertEqual(env["DEEPSEEK_API_KEY"], "sk-test")
        self.assertEqual(env["ANTHROPIC_AUTH_TOKEN"], "sk-test")
        self.assertEqual(env["ANTHROPIC_BASE_URL"], "https://api.deepseek.com/anthropic")
        self.assertEqual(env["ANTHROPIC_MODEL"], "deepseek-v4-pro")
        self.assertEqual(env["STUDENT_AGENT_PROVIDER"], "deepseek")
        self.assertEqual(env["STUDENT_AGENT_MODEL"], "deepseek-v4-pro")
        self.assertEqual(env["STUDENT_AGENT_EXECUTION_MODE"], "yolo")
        self.assertEqual(env["STUDENT_AGENT_SUPPRESS_EMBEDDING_REMINDER"], "1")

    def test_python_manual_config_can_set_separate_keys_and_base_urls(self) -> None:
        original = (
            comparison.CLAUDE_CODE_API_KEY,
            comparison.STUDENT_AGENT_API_KEY,
            comparison.CLAUDE_CODE_BASE_URL,
            comparison.STUDENT_AGENT_BASE_URL,
        )
        comparison.CLAUDE_CODE_API_KEY = "sk-cc"
        comparison.STUDENT_AGENT_API_KEY = "sk-student"
        comparison.CLAUDE_CODE_BASE_URL = "https://cc.example/anthropic"
        comparison.STUDENT_AGENT_BASE_URL = "https://student.example/v1"
        try:
            env = build_deepseek_env({"DEEPSEEK_API_KEY": "sk-env"}, model="deepseek-v4-pro")
        finally:
            (
                comparison.CLAUDE_CODE_API_KEY,
                comparison.STUDENT_AGENT_API_KEY,
                comparison.CLAUDE_CODE_BASE_URL,
                comparison.STUDENT_AGENT_BASE_URL,
            ) = original

        self.assertEqual(env["ANTHROPIC_AUTH_TOKEN"], "sk-cc")
        self.assertEqual(env["DEEPSEEK_API_KEY"], "sk-student")
        self.assertEqual(env["ANTHROPIC_BASE_URL"], "https://cc.example/anthropic")
        self.assertEqual(env["STUDENT_AGENT_BASE_URL"], "https://student.example/v1")

    def test_models_can_be_configured_per_agent_lane(self) -> None:
        env = build_deepseek_env(
            {"DEEPSEEK_API_KEY": "sk-test"},
            claude_model="deepseek-v4-pro",
            student_model="deepseek-v4-flash",
            flash_model="deepseek-v4-flash",
        )

        self.assertEqual(env["ANTHROPIC_MODEL"], "deepseek-v4-pro")
        self.assertEqual(env["ANTHROPIC_DEFAULT_OPUS_MODEL"], "deepseek-v4-pro")
        self.assertEqual(env["STUDENT_AGENT_MODEL"], "deepseek-v4-flash")

    def test_native_anthropic_env_uses_exported_key_and_clears_proxy_urls(self) -> None:
        env = build_native_anthropic_env(
            {
                "ANTHROPIC_API_KEY": "sk-native",
                "ANTHROPIC_BASE_URL": "https://proxy.example",
                "OPENAI_BASE_URL": "https://openai-proxy.example",
                "DEEPSEEK_API_KEY": "sk-proxy",
                "STUDENT_AGENT_BASE_URL": "https://student-proxy.example",
            },
            claude_model="claude-sonnet-4-6",
            student_model="claude-sonnet-4-6",
            flash_model="claude-sonnet-4-6",
        )

        self.assertEqual(env["ANTHROPIC_API_KEY"], "sk-native")
        self.assertEqual(env["ANTHROPIC_AUTH_TOKEN"], "sk-native")
        self.assertEqual(env["ANTHROPIC_MODEL"], "claude-sonnet-4-6")
        self.assertEqual(env["STUDENT_AGENT_PROVIDER"], "anthropic")
        self.assertEqual(env["STUDENT_AGENT_API"], "anthropic-messages")
        self.assertEqual(env["STUDENT_AGENT_MODEL"], "claude-sonnet-4-6")
        self.assertNotIn("ANTHROPIC_BASE_URL", env)
        self.assertNotIn("OPENAI_BASE_URL", env)
        self.assertNotIn("DEEPSEEK_API_KEY", env)
        self.assertNotIn("STUDENT_AGENT_BASE_URL", env)

    def test_native_anthropic_env_requires_key(self) -> None:
        with self.assertRaisesRegex(ValueError, "ANTHROPIC_API_KEY"):
            build_native_anthropic_env({})

    def test_benchmark_env_keeps_manual_default(self) -> None:
        env = build_benchmark_env({"DEEPSEEK_API_KEY": "sk-test"}, model="deepseek-v4-pro")

        self.assertEqual(env["STUDENT_AGENT_PROVIDER"], "deepseek")
        self.assertEqual(env["ANTHROPIC_MODEL"], "deepseek-v4-pro")

    def test_native_anthropic_metadata_writes_official_pricing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_root = Path(tmp)
            write_run_metadata(
                output_root,
                run_id="p3-anchor",
                repo_root=Path.cwd(),
                claude_model="claude-sonnet-4-6",
                student_model="claude-sonnet-4-6",
                provider_env="native-anthropic",
            )
            metadata = json.loads((output_root / "metadata.json").read_text(encoding="utf-8"))

        self.assertEqual(metadata["providerEnv"], "native-anthropic")
        self.assertEqual(metadata["pricing"]["currency"], "USD")
        self.assertEqual(metadata["pricing"]["claudeCode"]["input"], 3.0)
        self.assertEqual(metadata["pricing"]["claudeCode"]["output"], 15.0)
        self.assertEqual(metadata["pricing"]["claudeCode"]["cacheRead"], 0.30)

    def test_plan_contains_cc_and_student_runs(self) -> None:
        plan = build_run_plan(
            swe_instances=DEFAULT_SWE_INSTANCES,
            swe_limit=DEFAULT_SWE_LIMIT,
            terminal_tasks=["fix-git", "overfull-hbox"],
            claude_model="deepseek-v4-pro",
            student_model="deepseek-v4-flash",
            repo_root=Path("/repo/root"),
            output_root=Path("/repo/root/evals/results/comparison/test-run"),
            terminal_path=Path("/harbor/tasks/local"),
            run_swe_harness=True,
        )

        names = [step.name for step in plan]
        self.assertEqual(names, [
            "swe-produce-claude-code",
            "swe-produce-student-agent",
            "swe-harness-claude-code",
            "swe-harness-student-agent",
            "terminal-bench-claude-code",
            "terminal-bench-student-agent",
        ])
        student_terminal = plan[-1]
        claude_terminal = plan[-2]
        self.assertIn("--path", claude_terminal.command)
        self.assertIn("/harbor/tasks/local", claude_terminal.command)
        self.assertIn("--path", student_terminal.command)
        self.assertIn("/harbor/tasks/local", student_terminal.command)
        self.assertIn("--agent-import-path", claude_terminal.command)
        self.assertIn("benchmarks.terminal_bench.claude_code_cached:ClaudeCodeCached", claude_terminal.command)
        self.assertIn("--agent-import-path", student_terminal.command)
        self.assertIn("benchmarks.terminal_bench.student_agent:StudentAgent", student_terminal.command)
        self.assertIn("--include-task-name", student_terminal.command)
        self.assertIn("fix-git", student_terminal.command)
        claude_swe = plan[0]
        student_swe = plan[1]
        self.assertIn("deepseek-v4-pro", claude_swe.command)
        self.assertIn("student-agent-deepseek-v4-flash", student_swe.command)
        self.assertIn("2", claude_swe.command)
        self.assertIn("2", student_swe.command)
        self.assertIn("--student-variant", student_swe.command)
        self.assertIn("context_runtime", student_swe.command)
        self.assertIn("deepseek-v4-flash", student_terminal.command)
        self.assertIn("test-run-claude-code", plan[2].command)
        self.assertIn("test-run-student-agent", plan[3].command)
        claude_mounts = json.loads(
            claude_terminal.command[claude_terminal.command.index("--mounts") + 1]
        )
        self.assertEqual(claude_mounts[0]["target"], "/mnt/claude-code")
        self.assertTrue(claude_mounts[0]["read_only"])
        self.assertTrue(claude_mounts[0]["source"].endswith("/.cache/student-agent/claude-code"))
        self.assertIn(
            '[{"type":"bind","source":"/repo/root","target":"/mnt/student-agent","read_only":true}]',
            student_terminal.command,
        )

    def test_terminal_path_defaults_to_local_harbor_cache(self) -> None:
        self.assertEqual(
            DEFAULT_TERMINAL_PATH,
            Path("$HOME/.cache/harbor/tasks/kzqjKVWxvHZxV5xyLNLqJi"),
        )

    def test_default_swe_input_runs_two_instances(self) -> None:
        self.assertEqual(DEFAULT_SWE_LIMIT, 2)
        self.assertEqual(DEFAULT_SWE_INSTANCES, Path("evals/inputs/swebench-lite-2.jsonl"))

    def test_terminal_summary_extracts_rewards_and_exceptions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "result.json"
            path.write_text(json.dumps({
                "stats": {
                    "n_completed_trials": 5,
                    "n_errored_trials": 1,
                    "evals": {
                        "student-agent__deepseek-v4-pro__terminal-bench": {
                            "n_trials": 4,
                            "n_errors": 1,
                            "metrics": [{"mean": 0.8}],
                            "reward_stats": {"reward": {"1.0": ["fix-git__abc"]}},
                            "exception_stats": {"RuntimeError": ["overfull-hbox__def"]},
                        },
                    },
                    "n_input_tokens": None,
                    "n_cache_tokens": None,
                    "n_output_tokens": None,
                    "cost_usd": None,
                },
            }), encoding="utf-8")

            summary = summarize_terminal_result(path)

        self.assertEqual(summary["mean"], 0.8)
        self.assertEqual(summary["pass"], ["fix-git"])
        self.assertEqual(summary["exceptions"], {"RuntimeError": ["overfull-hbox"]})
        self.assertIsNone(summary["tokens"]["input"])

    def test_terminal_student_agent_tokens_are_summed_from_agent_summaries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            run_root = Path(tmp)
            for task, input_tokens, cache_tokens, output_tokens in [
                ("fix-git__abc", 10, 100, 4),
                ("prove-plus-comm__def", 20, 200, 6),
            ]:
                summary_path = run_root / task / "agent" / "student-agent-summary.json"
                summary_path.parent.mkdir(parents=True)
                summary_path.write_text(json.dumps({
                    "turnCount": input_tokens,
                    "guardRuleCounts": {
                        "verify_retry": 1 if task.startswith("fix-git") else 0,
                        "patch_retry": 1,
                    },
                    "tokenUsage": {
                        "inputTokens": input_tokens,
                        "cacheReadTokens": cache_tokens,
                        "outputTokens": output_tokens,
                        "totalTokens": input_tokens + cache_tokens + output_tokens,
                        "costUsd": {"total": 0.5},
                    },
                    "contextTokenEffect": {
                        "observedInputTokens": input_tokens,
                        "classifiedInputTokens": 7,
                        "unclassifiedInputTokens": input_tokens - 7,
                        "layers": {
                            "L0": {"estimatedTokens": 3},
                            "L1": {"estimatedTokens": 2},
                            "L2": {"estimatedTokens": 1},
                            "L3": {"estimatedTokens": 1},
                        },
                    },
                }), encoding="utf-8")

            tokens = summarize_terminal_student_agent_tokens(run_root)

        self.assertEqual(tokens["input"], 30)
        self.assertEqual(tokens["cache"], 300)
        self.assertEqual(tokens["output"], 10)
        self.assertEqual(tokens["total"], 340)
        self.assertEqual(tokens["costUsd"], 1.0)
        self.assertEqual(tokens["turns"], 30)
        self.assertEqual(tokens["guardRuleCounts"], {
            "verify_retry": 1,
            "patch_retry": 2,
        })
        self.assertEqual(
            [run["task"] for run in tokens["runs"]],
            ["fix-git", "prove-plus-comm"],
        )
        self.assertEqual(tokens["runs"][0]["turns"], 10)
        self.assertEqual(tokens["runs"][0]["guardRuleCounts"]["verify_retry"], 1)
        self.assertEqual(tokens["contextEffect"]["observedInputTokens"], 30)
        self.assertEqual(tokens["contextEffect"]["classifiedInputTokens"], 14)
        self.assertEqual(tokens["contextEffect"]["layers"]["L0"], 6)
        self.assertEqual(tokens["contextEffect"]["layers"]["L3"], 2)

    def test_swe_harness_report_summary_extracts_official_counts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "claude-code.test-run.json"
            report.write_text(json.dumps({
                "submitted_instances": 2,
                "completed_instances": 1,
                "resolved_instances": 1,
                "empty_patch_instances": 1,
                "error_instances": 0,
                "resolved_ids": ["astropy__astropy-12907"],
                "error_ids": [],
            }), encoding="utf-8")

            summary = summarize_swe_harness_report(report)

        self.assertEqual(summary["path"], str(report))
        self.assertEqual(summary["submitted"], 2)
        self.assertEqual(summary["completed"], 1)
        self.assertEqual(summary["resolved"], 1)
        self.assertEqual(summary["emptyPatches"], 1)
        self.assertEqual(summary["errors"], 0)

    def test_student_swe_harness_report_matches_model_qualified_filename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            report = root / "student-agent-gpt-5.5.test-run-student-agent.json"
            report.write_text("{}", encoding="utf-8")

            self.assertEqual(newest_swe_harness_report(root, "studentAgent"), report)

    def test_default_terminal_tasks_are_fixed(self) -> None:
        self.assertEqual(DEFAULT_TERMINAL_TASKS, [
            "overfull-hbox",
            "cobol-modernization",
            "fix-git",
            "prove-plus-comm",
            "modernize-scientific-stack",
        ])

    def test_default_swe_python_returns_python_command(self) -> None:
        self.assertIn("python", Path(default_swe_python()).name)


if __name__ == "__main__":
    unittest.main()
