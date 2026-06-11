import shlex
import subprocess
import unittest

from benchmarks.terminal_bench.student_agent import (
    DEFAULT_INSTALL_COMMAND,
    DEFAULT_NODE_INSTALL_COMMAND,
    build_student_agent_run_command,
)


class StudentAgentAdapterTests(unittest.TestCase):
    def test_run_command_writes_transcript_and_summary(self) -> None:
        command = build_student_agent_run_command(
            executable='exec student-agent "$@"',
            instruction='do "x"',
        )

        self.assertIn('/logs/agent/student-agent.txt', command)
        self.assertIn('/logs/agent/student-agent-summary.json', command)
        self.assertIn('--json-summary', command)
        self.assertIn('--prompt', command)
        self.assertIn('--run-mode eval', command)
        self.assertIn('--memory-dir /tmp/student-agent-memory', command)
        self.assertIn('cat "$log_path"', command)
        self.assertIn("sh -c", command)
        self.assertNotIn("sh -lc", command)
        self.assertIn("STUDENT_AGENT_HARBOR_WORKDIR", command)
        self.assertIn("find /app", command)
        self.assertIn('export STUDENT_AGENT_CWD="$PWD"', command)

        shell_script = shlex.split(command)[3]
        syntax_check = subprocess.run(
            ["sh", "-n", "-c", shell_script],
            capture_output=True,
            text=True,
        )
        self.assertEqual("", syntax_check.stderr)
        self.assertEqual(0, syntax_check.returncode)

    def test_default_node_install_uses_cache_when_mounted_and_retries_network_installs(self) -> None:
        self.assertIn("/mnt/student-agent-node", DEFAULT_NODE_INSTALL_COMMAND)
        self.assertIn("Acquire::Retries=3", DEFAULT_NODE_INSTALL_COMMAND)
        self.assertIn("curl --retry 3", DEFAULT_NODE_INSTALL_COMMAND)

    def test_default_install_uses_built_cache_when_mounted(self) -> None:
        self.assertIn("/mnt/student-agent-built", DEFAULT_INSTALL_COMMAND)
        self.assertIn("/mnt/student-agent", DEFAULT_INSTALL_COMMAND)
        self.assertIn("npm run build", DEFAULT_INSTALL_COMMAND)
        self.assertIn("npm install -g student-agent", DEFAULT_INSTALL_COMMAND)


if __name__ == "__main__":
    unittest.main()
