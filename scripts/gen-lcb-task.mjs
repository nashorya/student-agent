// Generate LCB-style "context pollution" eval tasks (agentic variant, route 1).
//
// Scenario (close to real life): a newly-added feature `computeUpgradeCharge`
// couples to ONE proration module that sits at the end of a multi-hop require
// chain. The repo carries MANY look-alike proration modules — every one of them
// defines and exports `proratedAmount`, every one looks self-consistent — but
// only the module actually on the live import chain has an off-by-one bug.
//
// Because grep "proratedAmount" returns N identical hits, the agent cannot
// shortcut: it must trace the feature's import chain (or read each body) to
// find the LIVE implementation. All discriminating signal lives in the repo,
// so any capable harness (Claude Code or student-agent) can solve it — the task
// measures EFFICIENCY (tool calls / tokens to reach the fix, and whether decoy
// files get edited), not a correctness gap.
//
// Tiers differ only by the number of decoy proration modules (look-alikes),
// which is the realistic difficulty knob: more historical siblings = more to
// disambiguate.
//
// Usage: node scripts/gen-lcb-task.mjs
// Produces: evals/tasks/lcb-pollution-small/  and  evals/tasks/lcb-pollution-large/

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TIERS = [
  { id: 'lcb-pollution-small', decoys: 6, padding: 10, timeout: 300 },
  { id: 'lcb-pollution-large', decoys: 24, padding: 40, timeout: 600 },
];

// ---- the LIVE module (end of the require chain) ---------------------------
// This is the ONLY proration implementation the feature actually uses, and the
// ONLY one with the off-by-one bug. Path is intentionally non-obvious.
const LIVE_PATH = 'src/billing/proration/standard.js';
const LIVE_BUGGY = `// Standard proration engine — the implementation wired into billing/proration.
// proratedAmount returns the portion of a monthly charge owed for a partial
// period: monthly * daysUsed / daysInMonth.
function proratedAmount(monthly, daysUsed, daysInMonth) {
  // BUG: off-by-one in the denominator.
  return (monthly * daysUsed) / (daysInMonth + 1);
}

module.exports = { proratedAmount };
`;

// ---- the require chain that reaches the live module -----------------------
// package main -> feature -> billing -> billing/proration -> standard (LIVE)
const INDEX_JS = `// Package entry point.
const { computeUpgradeCharge } = require('./features/annualUpgrade');
module.exports = { computeUpgradeCharge };
`;

const FEATURE_JS = `// New feature: mid-cycle plan upgrade charge.
// When a customer upgrades partway through the billing month, we charge the
// prorated difference between the new and old monthly price for the remaining
// days. This couples to the billing module's proration helper.
const billing = require('../billing');

function computeUpgradeCharge(oldMonthly, newMonthly, daysRemaining, daysInMonth) {
  const monthlyDiff = newMonthly - oldMonthly;
  return billing.proratedAmount(monthlyDiff, daysRemaining, daysInMonth);
}

module.exports = { computeUpgradeCharge };
`;

const BILLING_INDEX_JS = `// Billing module barrel. Re-exports the active proration engine.
// NOTE: several proration engines live under ./proration; this barrel selects
// the one that is currently in production.
const { proratedAmount } = require('./proration');

module.exports = { proratedAmount };
`;

const PRORATION_INDEX_JS = `// Proration sub-package. Historically this directory accumulated several
// engines (standard, legacy, classic, ...). The line below is the single
// source of truth for which engine billing actually uses.
const { proratedAmount } = require('./standard');

module.exports = { proratedAmount };
`;

// ---- decoy proration modules (look-alikes) --------------------------------
// Each exports `proratedAmount`. None is on the live chain. Most are correct;
// a couple carry DIFFERENT, plausible-looking quirks to bait a "just fix the
// one that looks off" heuristic. Fixing any of these does NOT pass the test.
const DECOY_STYLES = [
  // correct implementation (the common case among siblings)
  (name) => `  // ${name}: straightforward proration, no rounding.
  return (monthly * daysUsed) / daysInMonth;`,
  // correct but rounded — numerically identical for the test inputs
  (name) => `  // ${name}: proration with cent rounding.
  return Math.round((monthly * daysUsed) / daysInMonth * 100) / 100;`,
  // BAIT: a different-looking off-by-one (minus). Looks like "the bug" but is
  // not on the live chain, so editing it changes nothing the test sees.
  (name) => `  // ${name}: legacy denominator convention.
  return (monthly * daysUsed) / (daysInMonth - 1);`,
  // correct, expressed as a daily rate
  (name) => `  // ${name}: daily-rate formulation.
  const dailyRate = monthly / daysInMonth;
  return dailyRate * daysUsed;`,
];

function decoyModule(name, index, style) {
  const padding = Array.from({ length: 60 }, (_, i) =>
    `  // note ${name}-${i}: historical accounting detail, not user facing.`,
  ).join('\n');
  return `// ${name}.js — proration engine #${index} (NOT wired into billing).
// This is one of several historical proration engines. The production barrel
// (src/billing/proration/index.js) does NOT select this one. Do not edit it.
function proratedAmount(monthly, daysUsed, daysInMonth) {
${padding}
${style(name)}
}

// Legacy alias kept for backward compatibility.
function proratedAmountLegacy(monthly, daysUsed) {
  return proratedAmount(monthly, daysUsed, 30);
}

module.exports = { proratedAmount, proratedAmountLegacy };
`;
}

// Decoy module names + where they live. Plausible historical sprawl.
const DECOY_SLOTS = [
  'src/billing/proration/legacy.js',
  'src/billing/proration/classic.js',
  'src/billing/proration/v1.js',
  'src/billing/proration/engines/flat.js',
  'src/billing/proration/engines/daily.js',
  'src/finance/proration.js',
  'src/finance/proration_v2.js',
  'src/metrics/proration.js',
  'src/legacy/billing/proration.js',
  'src/legacy/billing/prorationOld.js',
];

function decoyPathFor(i) {
  if (i < DECOY_SLOTS.length) return DECOY_SLOTS[i];
  const dirs = ['src/billing/proration/engines', 'src/finance', 'src/metrics', 'src/legacy/billing'];
  const dir = dirs[i % dirs.length];
  return `${dir}/proration_${i}.js`;
}

// ---- unrelated padding files (bulk context, not proration) ----------------
const PADDING_NAMES = [
  'proratedRefund', 'proratedCredit', 'proratedDiscount', 'proratedTax',
  'proratedSeat', 'proratedUsage', 'proratedOverage', 'proratedTrial',
  'monthlyRecurringRevenue', 'annualRunRate', 'churnAdjustment', 'dunningSchedule',
  'invoiceRounding', 'taxWithholding', 'seatExpansion', 'usageRollup',
  'creditNoteTotal', 'refundWindow', 'couponLedger', 'arrearsRollover',
];

function paddingFile(name, index) {
  const padding = Array.from({ length: 80 }, (_, i) =>
    `  // note ${name}-${i}: internal accounting detail, not user facing.`,
  ).join('\n');
  return `// ${name}.js — billing helper #${index}. Unrelated to proratedAmount.
function ${name}(amount, factor, period) {
${padding}
  const base = amount * factor;
  return Math.round((base - base / (period || 30)) * 100) / 100;
}

module.exports = { ${name} };
`;
}

const INSTRUCTION = `A newly-added feature is charging customers the wrong amount.

\`computeUpgradeCharge(oldMonthly, newMonthly, daysRemaining, daysInMonth)\`
(exported from the package entry point) computes the prorated price difference
when a customer upgrades their plan mid-cycle. It currently returns a value
that is slightly off.

The correct upgrade charge is the prorated difference for the remaining days:

    (newMonthly - oldMonthly) * daysRemaining / daysInMonth

Find the root cause and fix it.

Be careful: this repository has accumulated MANY proration engines over time
(\`src/billing/proration/standard.js\`, \`.../legacy.js\`, \`src/finance/proration.js\`,
and more). Every one of them defines and exports a function named
\`proratedAmount\`, and most of them look correct. Only the engine that the
upgrade feature actually uses is broken. Trace which engine is really on the
live import chain before changing anything, and fix only that file. Do not edit
any other proration engine or unrelated file.
`;

const TEST_SH = `#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const { computeUpgradeCharge } = require('./src/index.js');
const eq = (a, b) => Math.abs(a - b) < 1e-9;
// (newMonthly - oldMonthly) * daysRemaining / daysInMonth
if (!eq(computeUpgradeCharge(10, 40, 15, 30), 15)) process.exit(1);
if (!eq(computeUpgradeCharge(0, 120, 10, 30), 40)) process.exit(1);
if (!eq(computeUpgradeCharge(0, 310, 31, 31), 310)) process.exit(1);
NODE
printf '1\\n' > "$REWARD_FILE"
`;

const SOLUTION_SH = `#!/usr/bin/env bash
set -euo pipefail

perl -0pi -e 's/\\(daysInMonth \\+ 1\\)/daysInMonth/' src/billing/proration/standard.js
`;

const PACKAGE_JSON = `{
  "name": "billing-suite",
  "version": "1.0.0",
  "private": true,
  "main": "src/index.js"
}
`;

function tomlFor(tier) {
  return `id = "${tier.id}"
title = "Trace the live proration engine amid ${tier.decoys} look-alike modules and fix the upgrade-charge bug"
mode = "direct"
tags = ["pollution", "long-context", "discovery", "call-graph", "billing", "debug"]
timeout_seconds = ${tier.timeout}
expected_files = ["src/billing/proration/standard.js"]
`;
}

async function writeFileEnsured(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function buildTier(tier) {
  const taskDir = join(ROOT, 'evals/tasks', tier.id);
  await rm(taskDir, { recursive: true, force: true });

  await writeFileEnsured(join(taskDir, 'task.toml'), tomlFor(tier));
  await writeFileEnsured(join(taskDir, 'instruction.md'), INSTRUCTION);
  await writeFileEnsured(join(taskDir, 'tests/test.sh'), TEST_SH);
  await writeFileEnsured(join(taskDir, 'solution/solve.sh'), SOLUTION_SH);

  const env = (p) => join(taskDir, 'environment', p);

  // Live require chain.
  await writeFileEnsured(env('package.json'), PACKAGE_JSON);
  await writeFileEnsured(env('src/index.js'), INDEX_JS);
  await writeFileEnsured(env('src/features/annualUpgrade.js'), FEATURE_JS);
  await writeFileEnsured(env('src/billing/index.js'), BILLING_INDEX_JS);
  await writeFileEnsured(env('src/billing/proration/index.js'), PRORATION_INDEX_JS);
  await writeFileEnsured(env(LIVE_PATH), LIVE_BUGGY);

  // Decoy proration engines (look-alikes, off the live chain).
  for (let i = 0; i < tier.decoys; i++) {
    const path = decoyPathFor(i);
    const name = path.split('/').pop().replace(/\.js$/, '');
    const style = DECOY_STYLES[i % DECOY_STYLES.length];
    await writeFileEnsured(env(path), decoyModule(name, i, style));
  }

  // Unrelated padding files (bulk context).
  for (let i = 0; i < tier.padding; i++) {
    const name = PADDING_NAMES[i % PADDING_NAMES.length];
    const suffix = Math.floor(i / PADDING_NAMES.length);
    const fileName = suffix === 0 ? `${name}.js` : `${name}_${suffix}.js`;
    const dirs = ['src/billing/helpers', 'src/finance/helpers', 'src/metrics/helpers'];
    const dir = dirs[i % dirs.length];
    await writeFileEnsured(env(join(dir, fileName)), paddingFile(name, i));
  }

  const total = tier.decoys + tier.padding + 6;
  return { taskDir, files: total };
}

for (const tier of TIERS) {
  const { taskDir, files } = await buildTier(tier);
  console.log(`built ${tier.id}: ${files} env files -> ${taskDir}`);
}
