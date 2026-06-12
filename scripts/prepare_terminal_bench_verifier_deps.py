#!/usr/bin/env python3
"""Prepare local Terminal-Bench verifier dependencies.

BUG-006: some Terminal-Bench verifiers install uv from astral.sh at verifier
runtime. That makes infra/network failures look like reward=0 task failures.

This script creates a local patched task copy and a derived Docker image with
uv/uvx preinstalled, so the verifier does not fetch uv from astral.sh while
scoring the trial.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path


DEFAULT_OVERFULL_TASK = (
    Path.home()
    / ".cache"
    / "harbor"
    / "tasks"
    / "ca36CXF7yAdWnRdpyfoihT"
    / "overfull-hbox"
)
DEFAULT_OUTPUT_ROOT = Path.home() / ".cache" / "student-agent" / "terminal-bench-local-tasks"
DEFAULT_UV_CACHE = Path.home() / ".cache" / "student-agent" / "uv"
DEFAULT_UV_VERSION = "0.9.5"
DEFAULT_UV_TARGET = "x86_64-unknown-linux-gnu"
DEFAULT_IMAGE_TAG = "student-agent-overfull-hbox:20251031-uv0.9.5"
DEFAULT_DOCKER_PLATFORM = "linux/amd64"
DEFAULT_AGENT_TIMEOUT_SEC = 2400.0


PATCHED_TEST_SH = """#!/bin/bash

# Patched by scripts/prepare_terminal_bench_verifier_deps.py.
# uv/uvx is prebaked into the verifier image; do not fetch astral.sh at runtime.

set -u

if ! command -v uvx >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    ln -sf "$(command -v uv)" /usr/local/bin/uvx
  else
    echo "Verifier setup failure: uvx is not installed in the verifier image." >&2
    echo 0 > /logs/verifier/reward.txt
    exit 98
  fi
fi

# Check if we're in a valid working directory
if [ "$PWD" = "/" ]; then
    echo "Error: No working directory set. Please set a WORKDIR in your Dockerfile before running this script."
    exit 1
fi

uv run \\
  --python 3.13 \\
  --with pytest==8.4.1 \\
  --with pytest-json-ctrf==0.3.5 \\
  pytest --ctrf /logs/verifier/ctrf.json /tests/test_outputs.py -rA


if [ $? -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
"""


def main() -> int:
    args = parse_args()
    source_task = args.task_dir.expanduser().resolve()
    output_task = args.output_root.expanduser().resolve() / source_task.name
    uv_binary = ensure_uv_binary(
        version=args.uv_version,
        target=args.uv_target,
        cache_dir=args.uv_cache.expanduser().resolve(),
    )
    if not args.skip_docker_build:
        build_uv_image(
            base_image=args.base_image,
            image_tag=args.image_tag,
            uv_binary=uv_binary,
            platform=args.docker_platform,
        )
    copy_and_patch_task(
        source_task=source_task,
        output_task=output_task,
        image_tag=args.image_tag,
        agent_timeout_sec=args.agent_timeout_sec,
    )
    print(output_task)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-dir", type=Path, default=DEFAULT_OVERFULL_TASK)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--uv-cache", type=Path, default=DEFAULT_UV_CACHE)
    parser.add_argument("--uv-version", default=DEFAULT_UV_VERSION)
    parser.add_argument("--uv-target", default=DEFAULT_UV_TARGET)
    parser.add_argument("--base-image", default="alexgshaw/overfull-hbox:20251031")
    parser.add_argument("--image-tag", default=DEFAULT_IMAGE_TAG)
    parser.add_argument("--docker-platform", default=DEFAULT_DOCKER_PLATFORM)
    parser.add_argument("--agent-timeout-sec", type=float, default=DEFAULT_AGENT_TIMEOUT_SEC)
    parser.add_argument("--skip-docker-build", action="store_true")
    return parser.parse_args()


def ensure_uv_binary(*, version: str, target: str, cache_dir: Path) -> Path:
    binary = cache_dir / version / target / "uv"
    if binary.exists():
        return binary
    archive = cache_dir / version / f"uv-{target}.tar.gz"
    archive.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://github.com/astral-sh/uv/releases/download/{version}/uv-{target}.tar.gz"
    if not archive.exists():
        print(f"[prepare-verifier] downloading {url}")
        urllib.request.urlretrieve(url, archive)
    with tarfile.open(archive, "r:gz") as tar:
        member = next(
            item for item in tar.getmembers()
            if item.isfile() and item.name.endswith("/uv")
        )
        binary.parent.mkdir(parents=True, exist_ok=True)
        extracted = tar.extractfile(member)
        if extracted is None:
            raise RuntimeError(f"could not extract uv from {archive}")
        binary.write_bytes(extracted.read())
    binary.chmod(0o755)
    return binary


def build_uv_image(*, base_image: str, image_tag: str, uv_binary: Path, platform: str) -> None:
    with tempfile.TemporaryDirectory(prefix="student-agent-uv-image-") as tmp:
        context = Path(tmp)
        shutil.copy2(uv_binary, context / "uv")
        (context / "Dockerfile").write_text(
            "\n".join([
                f"FROM {base_image}",
                "COPY uv /usr/local/bin/uv",
                "RUN chmod 0755 /usr/local/bin/uv && ln -sf /usr/local/bin/uv /usr/local/bin/uvx",
                "",
            ]),
            encoding="utf-8",
        )
        subprocess.run(
            ["docker", "build", "--platform", platform, "-t", image_tag, str(context)],
            check=True,
        )


def copy_and_patch_task(
    *,
    source_task: Path,
    output_task: Path,
    image_tag: str,
    agent_timeout_sec: float,
) -> None:
    if not source_task.exists():
        raise FileNotFoundError(source_task)
    if output_task.exists():
        shutil.rmtree(output_task)
    output_task.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source_task, output_task)
    patch_task_toml(
        output_task / "task.toml",
        image_tag=image_tag,
        agent_timeout_sec=agent_timeout_sec,
    )
    for test_script in [
        output_task / "tests" / "test.sh",
        output_task / "environment" / "tests" / "test.sh",
    ]:
        if test_script.exists():
            test_script.write_text(PATCHED_TEST_SH, encoding="utf-8")
            os.chmod(test_script, 0o755)


def patch_task_toml(path: Path, *, image_tag: str, agent_timeout_sec: float) -> None:
    text = path.read_text(encoding="utf-8")
    lines = []
    patched_image = False
    patched_agent_timeout = False
    section = ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped
        if line.startswith('docker_image = "'):
            lines.append(f'docker_image = "{image_tag}"')
            patched_image = True
        elif section == "[agent]" and stripped.startswith("timeout_sec = "):
            lines.append(f"timeout_sec = {agent_timeout_sec:.1f}")
            patched_agent_timeout = True
        else:
            lines.append(line)
    if not patched_image:
        raise RuntimeError(f"docker_image not found in {path}")
    if not patched_agent_timeout:
        raise RuntimeError(f"agent timeout_sec not found in {path}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
