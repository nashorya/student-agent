import shlex
import subprocess
import unittest

from benchmarks.terminal_bench.claude_code_cached import (
    build_cached_claude_install_command,
)


class ClaudeCodeCachedAdapterTests(unittest.TestCase):
    def test_install_command_uses_mounted_cache(self) -> None:
        command = build_cached_claude_install_command(
            cache_dir="/mnt/claude-code",
            version="2.1.172",
        )

        self.assertIn("/mnt/claude-code", command)
        self.assertIn("requested_version=2.1.172", command)
        self.assertIn("claude-$requested_version-linux-x64", command)
        self.assertIn("$HOME/.local/bin/claude", command)
        self.assertNotIn("https://claude.ai/install.sh", command)
        self.assertNotIn("downloads.claude.ai", command)

        syntax_check = subprocess.run(
            ["bash", "-n", "-c", command],
            capture_output=True,
            text=True,
        )
        self.assertEqual("", syntax_check.stderr)
        self.assertEqual(0, syntax_check.returncode)

    def test_install_command_quotes_cache_dir(self) -> None:
        command = build_cached_claude_install_command(
            cache_dir="/mnt/claude code",
            version=None,
        )

        self.assertIn(shlex.quote("/mnt/claude code"), command)


if __name__ == "__main__":
    unittest.main()
