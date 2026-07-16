import { createHash } from 'node:crypto';
import type { ArchiveSlashCommand } from '../cli/command-parser.js';
import { ArchiveService } from './service.js';

export async function executeArchiveCommand(root: string, command: ArchiveSlashCommand): Promise<string> {
  const service = new ArchiveService({ root });
  switch (command.subcommand) {
    case 'status': {
      const status = await service.status();
      return `Archive: ${status.discovery.writeMode}; validation: ${status.validation.ok ? 'ok' : `${status.validation.errors.length} error(s)`}; pending: ${status.pendingActions}`;
    }
    case 'check': {
      const validation = await service.check();
      return validation.ok ? 'Archive check passed.' : `Archive check failed:\n${validation.errors.map((item) => `- ${item.code}: ${item.message}`).join('\n')}`;
    }
    case 'build': {
      const result = await service.build();
      return `Archive dashboard built: ${result.dashboardPath}${result.validation.ok ? '' : ` (${result.validation.errors.length} historical validation error(s))`}`;
    }
    case 'init': {
      const result = await service.init();
      return `Archive initialized; dashboard built: ${result.dashboardPath}`;
    }
    case 'adr-new':
      return stage(service, 'create_adr', undefined, { title: command.title, summary: command.title, decisionStatus: 'proposed' });
    case 'bug-open':
      return stage(service, 'create_bug', undefined, { title: command.title, symptom: command.title, summary: command.title });
    case 'bug-update':
      return stage(service, 'update_bug', command.id, { status: command.status, summary: command.status ? `Update ${command.id} to ${command.status}` : `Update ${command.id}` });
  }
}

async function stage(service: ArchiveService, type: 'create_adr' | 'create_bug' | 'update_bug', entityId: string | undefined, payload: Record<string, unknown>): Promise<string> {
  const key = `command:${createHash('sha256').update(JSON.stringify([type, entityId, payload])).digest('hex').slice(0, 20)}`;
  const action = await service.stage({ key, taskId: 'manual-command', type, entityId, payload });
  return `Archive action staged: ${action.type} (${action.key})`;
}
