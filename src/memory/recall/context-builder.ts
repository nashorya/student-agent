import type {
  BuiltContext,
  ContextBuilderInput,
  ContextRunMode,
  ContextSection,
  L1SectionBudget,
  L1Tier,
  PiSchemaRenderMode,
  RecalledItem,
} from './types.js';
import type { TaskLedgerInput } from '../tasks/task-ledger.js';
import { TIER_BUDGETS } from './tier-selector.js';

const DEFAULT_TOKEN_BUDGET = 2000;
const TOKEN_CHAR_RATIO = 3.5;

/** Cross-turn stable prefix (safety/contracts/schema). Physical cache prefix. */
export const STATIC_CONTEXT_SECTION_NAMES = [
  'evalAutonomyRule',
  'anthropicExecutionOverride',
  'piContractSummary',
  'piSchemaFull',
  'systemRules',
  'toolRules',
] as const;

/** Per-turn / per-task mutable suffix — must sit after the cache breakpoint. */
export const DYNAMIC_CONTEXT_SECTION_NAMES = [
  'taskSpec',
  'hardConstraints',
  'taskLedger',
  'workingMemory',
  'recentErrors',
  'recentSignals',
  'recentTasks',
  'knacks',
  'fullResidentLessons',
  'preferences',
  'docFindings',
  'artifactRefs',
  'runArchiveRefs',
  'currentUserMessage',
] as const;

/** Priority/truncation order: static first, then dynamic (order within each group fixed). */
const SECTION_ORDER = [
  ...STATIC_CONTEXT_SECTION_NAMES,
  ...DYNAMIC_CONTEXT_SECTION_NAMES,
] as const;

/** Render-only marker: static prefix ends; not a budgeted section. */
export const CACHE_PREFIX_BREAKPOINT =
  '### cache_prefix_breakpoint\n# Static prefix ends; dynamic task context follows.';

export function isStaticContextSection(name: string): boolean {
  return (STATIC_CONTEXT_SECTION_NAMES as readonly string[]).includes(name);
}

/** Split already-built sections into static prefix / dynamic suffix (relative order kept). */
export function partitionContextSections(sections: ContextSection[]): {
  staticSections: ContextSection[];
  dynamicSections: ContextSection[];
} {
  return {
    staticSections: sections.filter((section) => isStaticContextSection(section.name)),
    dynamicSections: sections.filter((section) => !isStaticContextSection(section.name)),
  };
}

export const PI_CONTRACT_SUMMARY = `
PI CONTRACT:
- Inspect before editing.
- Use tools for file/code changes.
- Do not claim success without validation.
- Keep assumptions explicit.
- Respect user corrections and rejected assumptions.
- Final answer must summarize changed files and validation status.
`.trim();

export const EVAL_AUTONOMY_RULE = `
EVAL AUTONOMY RULE:
- This is a non-interactive evaluation run.
- There will be no follow-up user answer.
- Do not ask the user questions or request confirmation.
- Do not stop after planning.
- Inspect files before asking for clarification.
- Make reasonable assumptions, then edit and validate.
- If blocked, document the blocker and complete the best possible partial implementation.
- If validation fails for reasons unrelated to your change (pre-existing test configuration, environment, or build infrastructure), record it as an environment blocker and move on. Do not fight the environment.
- Do not retry the same failing validation approach more than twice. Change strategy or record the blocker.
- Before declaring the task complete, re-read the HARD CONSTRAINTS section and verify your changes satisfy every constraint. A solution that passes validation but violates a stated constraint is a failure.
- Asking the user for confirmation during eval is considered task failure.
`.trim();

export const ANTHROPIC_EXECUTION_OVERRIDE = `
CLAUDE EXECUTION OVERRIDE:
- This is an autonomous local coding task.
- Do not ask for permission to read, search, edit, or validate local files.
- Do not ask for confirmation before the first tool call.
- When uncertain, inspect first; do not ask first.
- Continue until you complete the task, hit a real blocker, or validation fails.
- Do not treat ordinary implementation uncertainty as a blocker.
`.trim();

export const RECALL_CITATION_RULE = `
RECALL CITATION RULE:
- Recalled knacks below have stable IDs.
- Only when a recalled knack materially informs a diagnosis, edit, or validation action, emit [[used_recall:<id>]] in that assistant message.
- Do not cite a knack merely because it was shown.
`.trim();

export const FULL_PI_SCHEMA = `
FULL PI SCHEMA:
The complete Pi provider/tool schema is intentionally excluded from the default L1 working set.
Render it only for strict/debug/schema-specific tasks or explicit user requests.
`.trim();

export class ContextBuilder {
  build(input: ContextBuilderInput): BuiltContext {
    const policy = resolveContextPolicy(input);
    const sections = buildSections(input, policy).sort((a, b) => a.priority - b.priority);
    if (!input.tier && input.maxTokenBudget !== undefined) {
      return applyLegacyBudget(sections, input.maxTokenBudget, 'standard', policy);
    }

    const tier = input.tier ?? 'standard';
    return applySectionBudgets(sections, TIER_BUDGETS[tier].sectionBudgets, tier, policy);
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_RATIO);
}

interface ContextPolicy {
  runMode: ContextRunMode;
  piSchemaRenderMode: PiSchemaRenderMode;
  evalAutonomyEnabled: boolean;
  fullPiSchemaRendered: boolean;
  anthropicExecutionOverrideEnabled: boolean;
}

function resolveContextPolicy(input: ContextBuilderInput): ContextPolicy {
  const runMode = input.runMode ?? 'interactive';
  const piSchemaRenderMode = input.piSchemaRenderMode ?? 'summary';
  return {
    runMode,
    piSchemaRenderMode,
    evalAutonomyEnabled: runMode === 'eval',
    fullPiSchemaRendered: piSchemaRenderMode === 'full',
    anthropicExecutionOverrideEnabled: runMode === 'eval',
  };
}

function buildSections(input: ContextBuilderInput, policy: ContextPolicy): ContextSection[] {
  const sections: ContextSection[] = [];
  if (policy.evalAutonomyEnabled) {
    sections.push(section('evalAutonomyRule', EVAL_AUTONOMY_RULE));
  }
  if (policy.anthropicExecutionOverrideEnabled) {
    sections.push(section('anthropicExecutionOverride', ANTHROPIC_EXECUTION_OVERRIDE));
  }
  if (policy.piSchemaRenderMode === 'summary' || policy.piSchemaRenderMode === 'full') {
    sections.push(section('piContractSummary', PI_CONTRACT_SUMMARY));
  }
  if (policy.fullPiSchemaRendered) {
    sections.push(section('piSchemaFull', FULL_PI_SCHEMA));
  }

  sections.push(section('taskSpec', [
    `Goal: ${input.workingMemory.goal}`,
    `Phase: ${input.workingMemory.phase}`,
    `Current step: ${input.workingMemory.currentStep}`,
  ].join('\n')));

  const hardConstraints = input.workingMemory.hardConstraints.trim();
  if (hardConstraints) {
    sections.push(section('hardConstraints', [
      'HARD CONSTRAINTS:',
      hardConstraints,
    ].join('\n')));
  }

  const ledgerContent = renderTaskLedger(input.taskLedger);
  if (ledgerContent) {
    sections.push(section('taskLedger', ledgerContent));
  }

  const openTodos = input.workingMemory.todos.filter((todo) => todo.status !== 'done');
  if (openTodos.length > 0) {
    sections.push(section('workingMemory', openTodos
      .map((todo) => `- [${todo.status}] ${todo.content}`)
      .join('\n')));
  }

  if (input.workingMemory.recentErrors.length > 0) {
    sections.push(section('recentErrors', input.workingMemory.recentErrors.map((error) => (
      `Error(${error.source}/${error.pattern}): ${error.summary}`
    )).join('\n')));
  }

  if (input.workingMemory.recentSignals.length > 0) {
    sections.push(section('recentSignals', input.workingMemory.recentSignals.map((signal) => (
      `Signal(${signal.kind}/${signal.severity}): ${signal.summary}`
    )).join('\n')));
  }

  addRecalledSection(sections, 'recentTasks', input.recallBundle.historicalTaskSnapshots ?? [], policy);
  if (input.fullResidentLessons !== undefined) {
    sections.push(section(
      'fullResidentLessons',
      input.fullResidentLessons.map((lesson) =>
        `[resident:${lesson.id}] ${lesson.summary}`).join('\n') || '[resident:empty]',
    ));
  } else {
    addRecalledSection(sections, 'knacks', input.recallBundle.knacks, policy);
  }
  addRecalledSection(sections, 'preferences', input.recallBundle.preferences, policy);
  addRecalledSection(sections, 'docFindings', input.recallBundle.docFindings, policy);
  addRecalledSection(sections, 'artifactRefs', input.recallBundle.artifactRefs ?? [], policy);
  addRecalledSection(sections, 'runArchiveRefs', input.recallBundle.runArchiveRefs ?? [], policy);

  return sections;
}

function addRecalledSection(
  sections: ContextSection[],
  name: string,
  items: RecalledItem[],
  policy: ContextPolicy,
): void {
  if (items.length === 0) return;
  const citationEnabled = name === 'knacks' && policy.runMode === 'eval';
  const lines = items.map((item) => citationEnabled
    ? `- [recall:${item.id}] ${item.summary}`
    : `- ${item.summary}`);
  sections.push(section(name, citationEnabled
    ? [RECALL_CITATION_RULE, ...lines].join('\n')
    : lines.join('\n')));
}

function renderTaskLedger(ledger?: TaskLedgerInput): string | null {
  if (!ledger) return null;
  const blocks: string[] = ['## Task Ledger'];

  if (ledger.confirmedFacts.length > 0) {
    blocks.push(
      '### Confirmed Facts',
      ...ledger.confirmedFacts.map((fact) =>
        `- [${fact.confidence}] ${fact.content} (source: ${fact.source})`,
      ),
    );
  }

  const activeRejections = ledger.rejectedAssumptions.filter((rejection) => !rejection.removedAt);
  if (activeRejections.length > 0) {
    blocks.push(
      '### Rejected Assumptions — DO NOT revisit these assumptions',
      ...activeRejections.map((rejection) => {
        const severity = rejection.severity === 'hard' ? 'HARD' : 'soft';
        return `- [${severity}] ${rejection.assumption} -- reason: ${rejection.reason}`;
      }),
    );
  }

  const openQuestions = ledger.openQuestions.filter((question) => question.status === 'open');
  if (openQuestions.length > 0) {
    blocks.push(
      '### Open Questions',
      ...openQuestions.map((question) =>
        `- ${question.question} (context: ${question.context})`,
      ),
    );
  }

  return blocks.length > 1 ? blocks.join('\n') : null;
}

function applySectionBudgets(
  sections: ContextSection[],
  budgets: L1SectionBudget,
  tier: L1Tier,
  policy: ContextPolicy,
): BuiltContext {
  const kept: ContextSection[] = [];
  const truncated: string[] = [];

  for (const current of sections) {
    const budget = getSectionBudget(current.name, budgets);
    if (isEvalProtectedSection(current.name, policy)) {
      kept.push(current);
      continue;
    }
    if (budget <= 0) {
      truncated.push(current.name);
      continue;
    }

    if (current.estimatedTokens <= budget) {
      kept.push(current);
      continue;
    }

    truncated.push(current.name);
    const truncatedContent = truncateToTokenBudget(current.content, budget);
    if (!truncatedContent) continue;
    kept.push(section(current.name, truncatedContent));
  }

  return {
    tier,
    sections: kept,
    totalEstimatedTokens: kept.reduce((sum, current) => sum + current.estimatedTokens, 0),
    truncated,
    ...policy,
  };
}

function applyLegacyBudget(
  sections: ContextSection[],
  budget: number,
  tier: L1Tier,
  policy: ContextPolicy,
): BuiltContext {
  const kept: ContextSection[] = [];
  const truncated: string[] = [];
  let total = 0;

  for (const current of sections) {
    if (total + current.estimatedTokens <= budget) {
      kept.push(current);
      total += current.estimatedTokens;
      continue;
    }

    if (isEvalProtectedSection(current.name, policy)) {
      kept.push(current);
      total += current.estimatedTokens;
      continue;
    }

    const remaining = budget - total;
    truncated.push(current.name);
    if (remaining <= 0) continue;

    const truncatedContent = truncateToTokenBudget(current.content, remaining);
    if (!truncatedContent) continue;

    const truncatedSection = section(current.name, truncatedContent);
    kept.push(truncatedSection);
    total += truncatedSection.estimatedTokens;
  }

  return {
    tier,
    sections: kept,
    totalEstimatedTokens: total,
    truncated,
    ...policy,
  };
}

function truncateToTokenBudget(content: string, tokenBudget: number): string {
  const maxChars = Math.max(0, Math.floor(tokenBudget * TOKEN_CHAR_RATIO));
  const marker = `\n[TRUNCATED at ${tokenBudget} tokens]`;
  if (maxChars <= marker.length) return '';
  return `${content.slice(0, maxChars - marker.length).trimEnd()}${marker}`;
}

function isEvalProtectedSection(name: string, policy: ContextPolicy): boolean {
  return policy.runMode === 'eval'
    && (name === 'hardConstraints' || name === 'taskSpec' || name === 'fullResidentLessons');
}

function section(name: string, content: string): ContextSection {
  return {
    name,
    priority: sectionPriority(name),
    content,
    estimatedTokens: estimateTokens(content),
  };
}

function sectionPriority(name: string): number {
  const index = SECTION_ORDER.indexOf(name as typeof SECTION_ORDER[number]);
  return index >= 0 ? index : SECTION_ORDER.length;
}

function getSectionBudget(name: string, budgets: L1SectionBudget): number {
  if (name === 'evalAutonomyRule' || name === 'anthropicExecutionOverride') {
    return budgets.systemRules;
  }
  if (name === 'piContractSummary' || name === 'piSchemaFull') {
    return budgets.toolRules;
  }
  if (name === 'recentTasks') {
    return budgets.historicalTaskSnapshots ?? budgets.runArchiveRefs;
  }
  if (name === 'fullResidentLessons') return budgets.knacks;
  return budgets[name as keyof L1SectionBudget] ?? 0;
}
