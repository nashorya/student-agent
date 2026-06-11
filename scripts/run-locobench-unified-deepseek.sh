#!/usr/bin/env bash
set -euo pipefail

# Manual key setup examples:
#   export ANTHROPIC_AUTH_TOKEN=sk-...
#   # or:
#   export DEEPSEEK_API_KEY=sk-...
#
# Then run:
#   bash scripts/run-locobench-unified-deepseek.sh
#
# Any arguments passed to this script are appended to the unified eval command,
# so you can override defaults with flags like:
#   bash scripts/run-locobench-unified-deepseek.sh --scenario c_api_gateway_easy_009_architectural_understanding_expert_01

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ORIGINAL_HOME="${HOME:-/tmp}"

if [[ -z "${ANTHROPIC_AUTH_TOKEN:-}" && -n "${DEEPSEEK_API_KEY:-}" ]]; then
  export ANTHROPIC_AUTH_TOKEN="${DEEPSEEK_API_KEY}"
fi

if [[ -z "${DEEPSEEK_API_KEY:-}" && -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  export DEEPSEEK_API_KEY="${ANTHROPIC_AUTH_TOKEN}"
fi

if [[ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  echo "Missing DeepSeek key. Set ANTHROPIC_AUTH_TOKEN or DEEPSEEK_API_KEY before running." >&2
  exit 2
fi

# Claude Code through DeepSeek's Anthropic-compatible endpoint.
export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://api.deepseek.com/anthropic}"
export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-deepseek-v4-pro[1m]}"
export ANTHROPIC_DEFAULT_OPUS_MODEL="${ANTHROPIC_DEFAULT_OPUS_MODEL:-deepseek-v4-pro[1m]}"
export ANTHROPIC_DEFAULT_SONNET_MODEL="${ANTHROPIC_DEFAULT_SONNET_MODEL:-deepseek-v4-pro[1m]}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="${ANTHROPIC_DEFAULT_HAIKU_MODEL:-deepseek-v4-flash}"
export CLAUDE_CODE_SUBAGENT_MODEL="${CLAUDE_CODE_SUBAGENT_MODEL:-deepseek-v4-flash}"
export CLAUDE_CODE_EFFORT_LEVEL="${CLAUDE_CODE_EFFORT_LEVEL:-max}"

# Student Agent through DeepSeek's OpenAI-compatible endpoint. These are forced
# for this wrapper so stale shell/global config cannot silently route the run to
# a different gateway or model. Override with SA_* variables if needed.
export STUDENT_AGENT_PROVIDER="${SA_PROVIDER:-deepseek}"
export STUDENT_AGENT_MODEL="${SA_MODEL:-deepseek-v4-pro}"
export STUDENT_AGENT_API="${SA_API:-openai-completions}"
export STUDENT_AGENT_BASE_URL="${SA_BASE_URL:-https://api.deepseek.com}"
unset OPENAI_BASE_URL

# Isolate student-agent config loading from ~/.student-agent/.env.
export HOME="${EVAL_HOME:-/tmp/student-agent-eval-home-unified-deepseek}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${ORIGINAL_HOME}/.npm}"

DATA_DIR="${DATA_DIR:-/tmp/locobench-agent/data}"
LOCOBENCH_AGENT_ROOT="${LOCOBENCH_AGENT_ROOT:-/tmp/locobench-agent}"
PYTHON_COMMAND="${PYTHON_COMMAND:-/tmp/locobench-agent/.venv/bin/python}"
TRIALS="${TRIALS:-1}"
LIMIT="${LIMIT:-1}"
STUDENT_AGENT_MAX_BUDGET_USD="${STUDENT_AGENT_MAX_BUDGET_USD:-1}"
CLAUDE_MAX_BUDGET_USD="${CLAUDE_MAX_BUDGET_USD:-2}"
RESULTS_DIR="${RESULTS_DIR:-}"

cmd=(
  npm run eval:locobench-agent:unified --
  --data-dir "${DATA_DIR}"
  --locobench-agent-root "${LOCOBENCH_AGENT_ROOT}"
  --python "${PYTHON_COMMAND}"
  --trials "${TRIALS}"
  --max-budget-usd "${STUDENT_AGENT_MAX_BUDGET_USD}"
  --claude-max-budget-usd "${CLAUDE_MAX_BUDGET_USD}"
)

if [[ -n "${LIMIT}" ]]; then
  cmd+=(--limit "${LIMIT}")
fi

if [[ -n "${SCENARIO_ID:-}" ]]; then
  cmd+=(--scenario "${SCENARIO_ID}")
fi

if [[ -n "${RESULTS_DIR}" ]]; then
  cmd+=(--results-dir "${RESULTS_DIR}")
fi

if [[ -n "${CLAUDE_MODEL_ARG:-}" ]]; then
  cmd+=(--claude-model "${CLAUDE_MODEL_ARG}")
fi

if [[ "$#" -gt 0 ]]; then
  cmd+=("$@")
fi

echo "Running unified LoCoBench-Agent eval with DeepSeek-backed Claude Code and Student Agent."
echo "  DATA_DIR=${DATA_DIR}"
echo "  LOCOBENCH_AGENT_ROOT=${LOCOBENCH_AGENT_ROOT}"
echo "  PYTHON_COMMAND=${PYTHON_COMMAND}"
echo "  HOME=${HOME}"
echo "  ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}"
echo "  ANTHROPIC_MODEL=${ANTHROPIC_MODEL}"
echo "  STUDENT_AGENT_BASE_URL=${STUDENT_AGENT_BASE_URL}"
echo "  STUDENT_AGENT_MODEL=${STUDENT_AGENT_MODEL}"
echo "  ANTHROPIC_AUTH_TOKEN=<set>"

cd "${REPO_ROOT}"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  printf 'Command:'
  printf ' %q' "${cmd[@]}"
  printf '\n'
  exit 0
fi

"${cmd[@]}"
