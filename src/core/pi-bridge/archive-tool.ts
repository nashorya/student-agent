import { createHash } from 'node:crypto';
import { Type } from '../pi-compat/index.js';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { ArchiveService } from '../../archive/service.js';
import type { PendingArchiveActionType } from '../../archive/pending-actions.js';

interface ArchiveRecordInput {
  action: Exclude<PendingArchiveActionType, 'accept_adr'>;
  taskId: string;
  entityId?: string;
  title?: string;
  summary: string;
  evidenceRefs?: string[];
  status?: string;
}

const schema = Type.Object({
  action: Type.Union([Type.Literal('create_adr'), Type.Literal('update_adr'), Type.Literal('create_bug'), Type.Literal('update_bug'), Type.Literal('append_index')]),
  taskId: Type.String({ description: 'Active Student Agent task ID.' }),
  entityId: Type.Optional(Type.String({ description: 'Existing ADR or bug ID for updates.' })),
  title: Type.Optional(Type.String()),
  summary: Type.String({ description: 'Concise durable project knowledge to record.' }),
  evidenceRefs: Type.Optional(Type.Array(Type.String())),
  status: Type.Optional(Type.String({ description: 'Requested implementation or bug status for an update.' })),
});

export function createArchiveRecordToolDefinition(cwd: string, options: { service?: ArchiveService } = {}) {
  const service = options.service ?? new ArchiveService({ root: cwd });
  return defineTool({
    name: 'archive_record', label: 'archive_record',
    description: 'Stage durable project history, ADR, and bug knowledge for validated archive maintenance.',
    promptSnippet: 'Stage durable INDEX, ADR, or buglog knowledge for application after verification',
    promptGuidelines: [
      'Record only durable project knowledge; do not create archive noise for trivial edits.',
      'Never mark an ADR accepted. ADR acceptance is reserved for an explicit user review response.',
      'Never mark a bug FIXED without passed verification evidence.',
    ],
    parameters: schema,
    async execute(_toolCallId, params: ArchiveRecordInput) {
      const payload: Record<string, unknown> = { title: params.title, summary: params.summary, evidenceRefs: params.evidenceRefs };
      if (params.action === 'create_adr') payload.decisionStatus = 'proposed';
      if (params.status) {
        if (params.action.includes('adr')) payload.implementationStatus = params.status;
        else payload.status = params.status;
      }
      const keySource = JSON.stringify([params.taskId, params.action, params.entityId, params.title, params.summary]);
      const key = `archive:${createHash('sha256').update(keySource).digest('hex').slice(0, 20)}`;
      const action = await service.stage({ key, taskId: params.taskId, type: params.action, entityId: params.entityId, payload });
      return { content: [{ type: 'text', text: `Staged archive action ${action.key} (${action.type}).` }], details: action };
    },
  });
}
