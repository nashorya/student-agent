#!/usr/bin/env bash
set -euo pipefail
cd "$SANDBOX_DIR"

if [ ! -f "EduGate_ScholarLink//src//main.c" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//src//main.c"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//src//components//validator.c" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//src//components//validator.c"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//src//components//router.c" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//src//components//router.c"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//src//components//monitoring.c" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//src//components//monitoring.c"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//include//edugate.h" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//include//edugate.h"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//src//http_handler.c" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//src//http_handler.c"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//tests//test_router.c" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//tests//test_router.c"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//docs//API_GUIDE.md" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//docs//API_GUIDE.md"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//config//gateway.conf" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//config//gateway.conf"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//Makefile" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//Makefile"
  exit 1
fi
if [ ! -f "EduGate_ScholarLink//README.md" ]; then
  echo "FAIL: expected file missing: EduGate_ScholarLink//README.md"
  exit 1
fi

printf "1\n" > "$REWARD_FILE"
echo "PASS: LoCoBench-Agent smoke verifier passed"
