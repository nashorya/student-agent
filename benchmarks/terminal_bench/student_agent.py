"""Harbor installed-agent adapter for student-agent.

Run with Harbor/Terminal-Bench:

    harbor run --dataset terminal-bench@2.0 \
      --agent-import-path benchmarks.terminal_bench.student_agent:StudentAgent \
      --model deepseek-v4-pro

The adapter keeps installation configurable because this repository may be run
from a local checkout rather than a published npm package. Set
STUDENT_AGENT_HARBOR_INSTALL_COMMAND to override the default install command.
"""

from __future__ import annotations

import os
import shlex
from typing import TYPE_CHECKING

try:
    from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
except ImportError:  # pragma: no cover - Harbor import path can vary by release.
    try:
        from harbor.agents.base import BaseInstalledAgent  # type: ignore
        from harbor.agents.utils import with_prompt_template  # type: ignore
    except ImportError:  # pragma: no cover - lets local unit tests import helpers without Harbor.
        class BaseInstalledAgent:  # type: ignore[no-redef]
            pass

        def with_prompt_template(func):  # type: ignore[no-redef]
            return func

if TYPE_CHECKING:
    from harbor.environments.base import BaseEnvironment
    from harbor.models.agent.context import AgentContext


DEFAULT_NODE_INSTALL_COMMAND = (
    "set -eu; "
    "if [ -x /mnt/student-agent-node/usr/bin/node ] && "
    "[ -d /mnt/student-agent-node/usr/lib/node_modules/npm ]; then "
    "mkdir -p /usr/bin /usr/lib/node_modules && "
    "cp -a /mnt/student-agent-node/usr/bin/node /usr/bin/node && "
    "rm -rf /usr/lib/node_modules/npm /usr/lib/node_modules/corepack && "
    "cp -a /mnt/student-agent-node/usr/lib/node_modules/npm /usr/lib/node_modules/npm && "
    "if [ -d /mnt/student-agent-node/usr/lib/node_modules/corepack ]; then "
    "cp -a /mnt/student-agent-node/usr/lib/node_modules/corepack /usr/lib/node_modules/corepack; "
    "fi && "
    "ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/bin/npm && "
    "ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/bin/npx; "
    "else "
    "export DEBIAN_FRONTEND=noninteractive && "
    "apt-get -o Acquire::Retries=3 update && "
    "apt-get -o Acquire::Retries=3 install -y --no-install-recommends "
    "build-essential ca-certificates curl gnupg && "
    "mkdir -p /etc/apt/keyrings && "
    "rm -f /etc/apt/keyrings/nodesource.gpg && "
    "curl --retry 3 --retry-all-errors --retry-delay 5 -fsSL "
    "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | "
    "gpg --batch --yes --dearmor -o /etc/apt/keyrings/nodesource.gpg && "
    'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] '
    'https://deb.nodesource.com/node_22.x nodistro main" > '
    "/etc/apt/sources.list.d/nodesource.list && "
    "apt-get -o Acquire::Retries=3 update && "
    "apt-get -o Acquire::Retries=3 install -y --no-install-recommends nodejs; "
    "fi"
)

DEFAULT_INSTALL_COMMAND = (
    "set -eu; "
    "if [ -f /mnt/student-agent-built/package.json ] && [ -d /mnt/student-agent ]; then "
    "rm -rf /tmp/student-agent && "
    "cp -a /mnt/student-agent-built /tmp/student-agent && "
    "tar --exclude=node_modules --exclude=.git --exclude=evals/results "
    "-C /mnt/student-agent -cf - . | tar -C /tmp/student-agent -xf - && "
    "cd /tmp/student-agent && npm run build; "
    "else "
    "npm install -g student-agent; "
    "fi"
)

STUDENT_AGENT_ENV_KEYS = (
    "STUDENT_AGENT_PROVIDER",
    "STUDENT_AGENT_API",
    "STUDENT_AGENT_BASE_URL",
    "STUDENT_AGENT_MODEL",
    "STUDENT_AGENT_EXECUTION_MODE",
    "STUDENT_AGENT_SUPPRESS_EMBEDDING_REMINDER",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
)

DEFAULT_STUDENT_AGENT_EXECUTABLE = (
    "if [ -x /tmp/student-agent/node_modules/.bin/tsx ] && "
    "[ -f /tmp/student-agent/bin/student-agent ]; then "
    'exec /tmp/student-agent/node_modules/.bin/tsx /tmp/student-agent/bin/student-agent "$@"; '
    "else "
    'exec student-agent "$@"; '
    "fi"
)

DEFAULT_AGENT_LOG_PATH = "/logs/agent/student-agent.txt"
DEFAULT_AGENT_SUMMARY_PATH = "/logs/agent/student-agent-summary.json"


class StudentAgent(BaseInstalledAgent):
    """Run student-agent inside a Harbor task environment."""

    @staticmethod
    def name() -> str:
        return "student-agent"

    async def install(self, environment: "BaseEnvironment") -> None:
        node_install_command = os.environ.get(
            "STUDENT_AGENT_HARBOR_NODE_INSTALL_COMMAND",
            DEFAULT_NODE_INSTALL_COMMAND,
        )
        install_command = os.environ.get(
            "STUDENT_AGENT_HARBOR_INSTALL_COMMAND",
            DEFAULT_INSTALL_COMMAND,
        )
        if node_install_command.strip():
            await self.exec_as_root(
                environment,
                "command -v node >/dev/null 2>&1 || "
                f"({node_install_command})",
            )
        await self.exec_as_root(
            environment,
            "command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1",
        )
        await self.exec_as_root(environment, install_command)

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: "BaseEnvironment",
        context: "AgentContext",
    ) -> None:
        quoted_instruction = shlex.quote(instruction)
        executable = os.environ.get(
            "STUDENT_AGENT_HARBOR_EXECUTABLE",
            DEFAULT_STUDENT_AGENT_EXECUTABLE,
        )
        log_path = os.environ.get("STUDENT_AGENT_HARBOR_LOG_PATH", DEFAULT_AGENT_LOG_PATH)
        summary_path = os.environ.get("STUDENT_AGENT_HARBOR_SUMMARY_PATH", DEFAULT_AGENT_SUMMARY_PATH)
        command = os.environ.get(
            "STUDENT_AGENT_HARBOR_RUN_COMMAND",
            build_student_agent_run_command(
                executable=executable,
                instruction=instruction,
                log_path=log_path,
                summary_path=summary_path,
            ),
        )
        await self.exec_as_agent(environment, command, env=self._run_env())

    def populate_context_post_run(self, context: "AgentContext") -> None:
        context.metadata = {
            "agent_name": self.name(),
            "agent_adapter": "benchmarks.terminal_bench.student_agent:StudentAgent",
        }

    def _run_env(self) -> dict[str, str]:
        return {
            key: value
            for key in STUDENT_AGENT_ENV_KEYS
            if (value := self._get_env(key)) is not None
        }


def build_student_agent_run_command(
    *,
    executable: str,
    instruction: str,
    log_path: str = DEFAULT_AGENT_LOG_PATH,
    summary_path: str = DEFAULT_AGENT_SUMMARY_PATH,
) -> str:
    """Build the shell command used inside the Harbor task container."""
    script = (
        "mkdir -p /logs/agent && "
        f"log_path={shlex.quote(log_path)} && "
        f"summary_path={shlex.quote(summary_path)} && "
        "rm -f \"$log_path\" \"$summary_path\" && "
        "if [ -n \"${STUDENT_AGENT_HARBOR_WORKDIR:-}\" ]; then "
        "cd \"$STUDENT_AGENT_HARBOR_WORKDIR\"; "
        "elif ! git -C \"$PWD\" rev-parse --is-inside-work-tree >/dev/null 2>&1; then "
        "git_dir=$(find /app -mindepth 2 -maxdepth 4 -type d -name .git "
        "-print -quit 2>/dev/null); "
        "if [ -n \"$git_dir\" ]; then cd \"${git_dir%/.git}\"; fi; "
        "fi && "
        "export STUDENT_AGENT_CWD=\"$PWD\" && "
        f"({executable}) > \"$log_path\" 2>&1; "
        "code=$?; "
        "cat \"$log_path\"; "
        "exit \"$code\""
    )
    return (
        "STUDENT_AGENT_TUI=0 "
        f"sh -c {shlex.quote(script)} "
        f"student-agent --prompt {shlex.quote(instruction)} "
        "--run-mode eval "
        "--memory-dir /tmp/student-agent-memory "
        f"--json-summary {shlex.quote(summary_path)}"
    )


__all__ = ["StudentAgent"]
