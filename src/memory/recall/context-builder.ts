import type {
  BuiltContext,
  ContextBuilderInput,
  ContextSection,
  L1SectionBudget,
  L1Tier,
  RecalledItem,
} from './types.js';
import type { TaskLedgerInput } from '../tasks/task-ledger.js';
import { TIER_BUDGETS } from './tier-selector.js';

const DEFAULT_TOKEN_BUDGET = 2000;
const TOKEN_CHAR_RATIO = 3.5;
const SECTION_ORDER = [
  'systemRules',
  'toolRules',
  'taskSpec',
  'taskLedger',
  'workingMemory',
  'recentErrors',
  'recentSignals',
  'recentTasks',
  'knacks',
  'preferences',
  'docFindings',
  'artifactRefs',
  'runArchiveRefs',
  'currentUserMessage',
] as const;

export class ContextBuilder {
  build(input: ContextBuilderInput): BuiltContext {
    const sections = buildSections(input).sort((a, b) => a.priority - b.priority);
    if (!input.tier && input.maxTokenBudget !== undefined) {
      return applyLegacyBudget(sections, input.maxTokenBudget, 'standard');
    }

    const tier = input.tier ?? 'standard';
    return applySectionBudgets(sections, TIER_BUDGETS[tier].sectionBudgets, tier);
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_RATIO);
}

function buildSections(input: ContextBuilderInput): ContextSection[] {
  const sections: ContextSection[] = [];
  sections.push(section('taskSpec', [
    `Goal: ${input.workingMemory.goal}`,
    `Phase: ${input.workingMemory.phase}`,
    `Current step: ${input.workingMemory.currentStep}`,
  ].join('\n')));

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

  addRecalledSection(sections, 'recentTasks', input.recallBundle.historicalTaskSnapshots ?? []);
  addRecalledSection(sections, 'knacks', input.recallBundle.knacks);
  addRecalledSection(sections, 'preferences', input.recallBundle.preferences);
  addRecalledSection(sections, 'docFindings', input.recallBundle.docFindings);
  addRecalledSection(sections, 'artifactRefs', input.recallBundle.artifactRefs ?? []);
  addRecalledSection(sections, 'runArchiveRefs', input.recallBundle.runArchiveRefs ?? []);

  return sections;
}

function addRecalledSection(
  sections: ContextSection[],
  name: string,
  items: RecalledItem[],
): void {
  if (items.length === 0) return;
  sections.push(section(name, items.map((item) => `- ${item.summary}`).join('\n')));
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
): BuiltContext {
  const kept: ContextSection[] = [];
  const truncated: string[] = [];

  for (const current of sections) {
    const budget = getSectionBudget(current.name, budgets);
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
  };
}

function applyLegacyBudget(sections: ContextSection[], budget: number, tier: L1Tier): BuiltContext {
  const kept: ContextSection[] = [];
  const truncated: string[] = [];
  let total = 0;

  for (const current of sections) {
    if (total + current.estimatedTokens <= budget) {
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
  };
}

function truncateToTokenBudget(content: string, tokenBudget: number): string {
  const maxChars = Math.max(0, Math.floor(tokenBudget * TOKEN_CHAR_RATIO));
  return content.slice(0, maxChars).trimEnd();
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
  if (name === 'recentTasks') {
    return budgets.historicalTaskSnapshots ?? budgets.runArchiveRefs;
  }
  return budgets[name as keyof L1SectionBudget] ?? 0;
}
