#!/usr/bin/env python3
"""Download the Linux Claude Code CLI once for Harbor task containers."""

from __future__ import annotations

import argparse
import os
import stat
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path


DEFAULT_VERSION = os.environ.get("CLAUDE_CODE_CACHED_VERSION", "2.1.172")
DEFAULT_CACHE_DIR = Path.home() / ".cache" / "student-agent" / "claude-code"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        path = ensure_claude_code_cache(
            cache_dir=args.cache_dir,
            version=args.version,
            url=args.url,
        )
    except Exception as err:
        print(f"[claude-cache] {err}", file=sys.stderr)
        return 1
    print(path)
    return 0


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument("--url", help="Override the Claude Code Linux x64 download URL.")
    return parser.parse_args(argv)


def ensure_claude_code_cache(
    *,
    cache_dir: Path = DEFAULT_CACHE_DIR,
    version: str = DEFAULT_VERSION,
    url: str | None = None,
) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"claude-{version}-linux-x64"
    if target.exists() and target.stat().st_size > 0:
        make_executable(target)
        return target

    download_url = url or default_download_url(version)
    tmp = target.with_suffix(".tmp")
    if tmp.exists():
        tmp.unlink()
    print(f"[claude-cache] downloading {download_url}", file=sys.stderr)
    if shutil.which("curl"):
        download_with_curl(download_url, tmp)
    else:
        download_with_urllib(download_url, tmp)
    if tmp.stat().st_size <= 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"downloaded empty Claude Code binary from {download_url}")
    tmp.replace(target)
    make_executable(target)
    return target


def default_download_url(version: str) -> str:
    return f"https://downloads.claude.ai/claude-code-releases/{version}/linux-x64/claude"


def download_with_curl(url: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "curl",
            "-fL",
            "--retry",
            "8",
            "--retry-all-errors",
            "--retry-delay",
            "3",
            "--connect-timeout",
            "30",
            "--continue-at",
            "-",
            "-o",
            str(path),
            url,
        ],
        check=True,
    )


def download_with_urllib(url: str, path: Path) -> None:
    with urllib.request.urlopen(url) as response, path.open("wb") as out:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)


def make_executable(path: Path) -> None:
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


if __name__ == "__main__":
    raise SystemExit(main())
