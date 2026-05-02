import type { ConfirmationProvider } from './types.js';

export class AlwaysAllowProvider implements ConfirmationProvider {
  async confirm(_op: { toolName: string; input: unknown; reason: string }): Promise<boolean> {
    return true;
  }
}

export class LogAndDenyProvider implements ConfirmationProvider {
  async confirm(op: { toolName: string; input: unknown; reason: string }): Promise<boolean> {
    console.warn(`[executor] high-risk op blocked: ${op.toolName} — ${op.reason}`);
    return false;
  }
}
