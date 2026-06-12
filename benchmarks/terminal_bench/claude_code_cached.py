"""Harbor installed-agent adapter for a cached Claude Code CLI.

Harbor's built-in ``claude-code`` adapter downloads Claude Code inside every
task container. That is correct for isolation, but expensive for repeated local
benchmark smoke runs. This adapter expects a Linux Claude Code binary to be
bind-mounted into the task container and copies it into the agent user's PATH.
"""

from __future__ import annotations

import os
import shlex

try:
    from harbor.agents.installed.claude_code import ClaudeCode
except ImportError:  # pragma: no cover - lets local unit tests import helpers without Harbor.
    class ClaudeCode:  # type: ignore[no-redef]
        _version: str | None = None

        @staticmethod
        def name() -> str:
            return "claude-code"


DEFAULT_CLAUDE_CODE_CACHE_MOUNT = "/mnt/claude-code"


class ClaudeCodeCached(ClaudeCode):
    """Claude Code adapter that installs from a mounted local binary cache."""

    async def install(self, environment) -> None:  # type: ignore[no-untyped-def]
        cache_dir = os.environ.get(
            "CLAUDE_CODE_CACHE_MOUNT",
            DEFAULT_CLAUDE_CODE_CACHE_MOUNT,
        )
        await self.exec_as_agent(
            environment,
            build_cached_claude_install_command(cache_dir=cache_dir, version=self._version),
        )


def build_cached_claude_install_command(
    *,
    cache_dir: str = DEFAULT_CLAUDE_CODE_CACHE_MOUNT,
    version: str | None = None,
) -> str:
    """Build the shell command that installs Claude Code from a mounted cache."""
    return (
        "set -euo pipefail; "
        f"cache_dir={shlex.quote(cache_dir)}; "
        f"requested_version={shlex.quote(version or '')}; "
        "mkdir -p \"$HOME/.local/bin\"; "
        "candidate=\"\"; "
        "if [ -n \"$requested_version\" ] && "
        "[ -f \"$cache_dir/claude-$requested_version-linux-x64\" ]; then "
        "candidate=\"$cache_dir/claude-$requested_version-linux-x64\"; "
        "fi; "
        "if [ -z \"$candidate\" ] && [ -f \"$cache_dir/claude\" ]; then "
        "candidate=\"$cache_dir/claude\"; "
        "fi; "
        "if [ -z \"$candidate\" ] && [ -d \"$cache_dir\" ]; then "
        "candidate=$(find \"$cache_dir\" -maxdepth 1 -type f "
        "-name 'claude-*-linux-x64' -print 2>/dev/null | sort | tail -n 1); "
        "fi; "
        "if [ -z \"$candidate\" ]; then "
        "echo \"Claude Code cache miss. Run scripts/cache_claude_code_cli.py "
        "and mount the cache dir at $cache_dir.\" >&2; "
        "exit 42; "
        "fi; "
        "cp \"$candidate\" \"$HOME/.local/bin/claude\"; "
        "chmod 755 \"$HOME/.local/bin/claude\"; "
        "echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> \"$HOME/.bashrc\"; "
        "export PATH=\"$HOME/.local/bin:$PATH\"; "
        "claude --version"
    )


__all__ = [
    "ClaudeCodeCached",
    "build_cached_claude_install_command",
]
