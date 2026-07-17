#!/usr/bin/env bash
set -uo pipefail

results_root="evals/results/jspace-compaction"
log_path="evals/results/formal-run.log"
status_path="evals/results/formal-run-status.json"
mkdir -p "$results_root"

write_status() {
  local stage="$1"
  local detail="$2"
  local control_summary="${3:-}"
  local pilot_summary="${4:-}"
  local formal_summary="${5:-}"
  jq -n \
    --arg stage "$stage" \
    --arg detail "$detail" \
    --arg updatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg controlSummary "$control_summary" \
    --arg pilotSummary "$pilot_summary" \
    --arg formalSummary "$formal_summary" \
    '{stage:$stage, detail:$detail, updatedAt:$updatedAt,
      controlSummary:(if $controlSummary == "" then null else $controlSummary end),
      pilotSummary:(if $pilotSummary == "" then null else $pilotSummary end),
      formalSummary:(if $formalSummary == "" then null else $formalSummary end)}' \
    > "$status_path"
}

latest_summary() {
  find "$results_root" -mindepth 2 -maxdepth 2 -name summary.json -print0 \
    | xargs -0 ls -t 2>/dev/null | head -1
}

exec >> "$log_path" 2>&1
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] gated formal pipeline started"
write_status "offline_checks" "Generating and validating the controlled long-context fixture."

node scripts/generate-jspace-context-fixture.mjs || {
  write_status "offline_failed" "Context fixture generation failed."
  exit 1
}
npm test -- --run \
  src/evals/__tests__/provider-request-policy.test.ts \
  src/evals/__tests__/jspace-compaction-runner.test.ts \
  src/evals/__tests__/agent-runner.test.ts \
  src/evals/__tests__/sandbox.test.ts || {
  write_status "offline_failed" "Relevant eval tests failed."
  exit 1
}
npm run build || {
  write_status "offline_failed" "TypeScript build failed."
  exit 1
}

control_summary="${JSPACE_CONTROL_SUMMARY:-}"
if [[ -z "$control_summary" ]]; then
  write_status "control_running" "Running one current-arm formal control probe."
  if ! npm run eval:jspace-recovery -- \
    --seeds 1 --control-only --arm current --keep-sandboxes; then
    control_summary="$(latest_summary)"
    write_status "control_failed" \
      "Control did not pass completion, thinking, verifier, isolation, or 50-80k boundary gates." \
      "$control_summary"
    exit 1
  fi
  control_summary="$(latest_summary)"
fi

write_status "forced_pilot_running" \
  "Control passed; running one plain forced pilot to validate post-compaction volume." \
  "$control_summary"
if ! npm run eval:jspace-recovery -- --seeds 1 --arm plain --keep-sandboxes; then
  pilot_summary="$(latest_summary)"
  write_status "forced_pilot_failed" \
    "Forced pilot produced artifacts but failed one or more formal gates." \
    "$control_summary" "$pilot_summary"
  exit 1
fi

pilot_summary="$(latest_summary)"
write_status "formal_running" \
  "Control and forced pilot passed every gate; formal 3-seed run has started." \
  "$control_summary" "$pilot_summary"

if npm run eval:jspace-recovery -- --seeds 3 --keep-sandboxes; then
  formal_summary="$(latest_summary)"
  write_status "formal_complete" "Formal 3-seed run completed successfully." \
    "$control_summary" "$pilot_summary" "$formal_summary"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] formal run complete"
else
  formal_summary="$(latest_summary)"
  write_status "formal_finished_with_failures" \
    "Formal run produced artifacts but one or more gates failed; inspect the linked summary." \
    "$control_summary" "$pilot_summary" "$formal_summary"
  exit 1
fi
