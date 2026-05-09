import { PreferenceCandidatesManager } from '../candidates/manager.js';
import { PlanRevisionManager } from '../plan-revisions/manager.js';
import { PreferencesManager } from '../preferences/manager.js';
import { QuestionsManager } from '../questions/manager.js';

export interface WhyEntry {
  source: 'preference' | 'candidate' | 'question' | 'plan_revision';
  id: string;
  summary: string;
  trace?: string[];
}

export class WhyManager {
  constructor(private readonly memoryDir: string) {}

  async explain(query = '', options: { trace?: boolean } = {}): Promise<WhyEntry[]> {
    const [preferences, candidates, questions, planRevisions] = await Promise.all([
      PreferencesManager.getInstance(this.memoryDir).getAll(),
      PreferenceCandidatesManager.getInstance(this.memoryDir).getAll(),
      QuestionsManager.getInstance(this.memoryDir).getAll(),
      PlanRevisionManager.getInstance(this.memoryDir).getAll(),
    ]);
    const needle = query.trim().toLowerCase();
    const entries: WhyEntry[] = [];

    for (const preference of preferences) {
      if (!matches(needle, preference.rule)) continue;
      entries.push({
        source: 'preference',
        id: preference.id,
        summary: preference.rule,
        trace: options.trace ? [
          `source_type=${preference.provenance.source_type}`,
          `task_id=${preference.provenance.task_id}`,
          `session_ref=${preference.provenance.session_ref}`,
          `created_at=${preference.provenance.created_at}`,
        ] : undefined,
      });
    }

    for (const candidate of candidates) {
      if (!matches(needle, candidate.pattern)) continue;
      entries.push({
        source: 'candidate',
        id: candidate.id,
        summary: `${candidate.pattern} (${candidate.status})`,
        trace: options.trace ? [
          `observations=${candidate.observations}`,
          `contradictions=${candidate.contradictions}`,
          `breaker=${candidate.breaker_report?.id ?? 'none'}`,
          ...candidate.provenance.map((item) => `${item.source_type}:${item.task_id}:${item.trust_status}`),
        ] : undefined,
      });
    }

    for (const question of questions) {
      if (!matches(needle, `${question.context} ${question.resolution ?? ''}`)) continue;
      entries.push({
        source: 'question',
        id: question.id,
        summary: `${question.context}${question.resolution ? ` -> ${question.resolution}` : ''}`,
        trace: options.trace ? [
          `error=${question.error_type}/${question.error_subtype}`,
          `status=${question.status}`,
          `hit_count=${question.hit_count}`,
          `decay_factor=${question.decay_factor ?? 1}`,
        ] : undefined,
      });
    }

    for (const revision of planRevisions) {
      if (!matches(needle, `${revision.agent_plan_summary} ${revision.user_revision_summary} ${revision.reason_inferred}`)) continue;
      entries.push({
        source: 'plan_revision',
        id: revision.id,
        summary: `${revision.diff_type}: ${revision.user_revision_summary}`,
        trace: options.trace ? [
          `trust_status=${revision.trust_status}`,
          `task_id=${revision.task_id}`,
          `session_ref=${revision.session_ref}`,
          `observations=${revision.observations}`,
          `reason=${revision.reason_inferred}`,
          ...revision.provenance.map((item) => `${item.source_type}:${item.task_id}:${item.trust_status}`),
        ] : undefined,
      });
    }

    return entries.slice(0, 10);
  }
}

function matches(needle: string, value: string): boolean {
  return !needle || value.toLowerCase().includes(needle);
}
