export interface ForcedCompactionEvent {
  boundary: string;
  requestedAt: string;
  completedAt?: string;
  status: 'requested' | 'completed' | 'failed';
  error?: string;
  productApi: 'AgentSession.compact';
  lifecycle: {
    startObserved: boolean;
    endObserved: boolean;
    reason?: 'manual' | 'threshold' | 'overflow';
    aborted?: boolean;
    willRetry?: boolean;
  };
  state: {
    messagesBefore: number | null;
    messagesAfter: number | null;
    entriesBefore: number | null;
    entriesAfter: number | null;
    changed: boolean;
  };
  nextPhaseStartedAt?: string;
}

interface CompactableSession {
  compact?: (...args: unknown[]) => Promise<unknown>;
  subscribe?: (listener: (event: unknown) => void) => () => void;
  agent?: { state?: { messages?: unknown[] } };
  sessionManager?: { getEntries?: () => unknown[] };
}

export class ForcedCompactionController {
  private readonly completedBoundaries = new Set<string>();
  readonly events: ForcedCompactionEvent[] = [];

  constructor(
    private readonly session: unknown,
    private readonly phaseBoundaries: ReadonlySet<number>,
  ) {}

  shouldCompactAfterPhase(phaseNumber: number): boolean {
    return this.phaseBoundaries.has(phaseNumber);
  }

  noteNextPhaseStarted(phaseNumber: number): void {
    const event = [...this.events].reverse().find((candidate) =>
      candidate.status === 'completed' && candidate.boundary === `phase:${phaseNumber - 1}`);
    if (event) event.nextPhaseStartedAt = new Date().toISOString();
  }

  async compactAfterPhase(phaseNumber: number): Promise<void> {
    const boundary = `phase:${phaseNumber}`;
    if (this.completedBoundaries.has(boundary)) return;

    const event: ForcedCompactionEvent = {
      boundary,
      requestedAt: new Date().toISOString(),
      status: 'requested',
      productApi: 'AgentSession.compact',
      lifecycle: { startObserved: false, endObserved: false },
      state: {
        messagesBefore: sessionMessageCount(this.session),
        messagesAfter: null,
        entriesBefore: sessionEntryCount(this.session),
        entriesAfter: null,
        changed: false,
      },
    };
    this.events.push(event);

    const compact = (this.session as CompactableSession).compact;
    if (typeof compact !== 'function') {
      event.status = 'failed';
      event.error =
        'Pinned Pi AgentSession does not expose session.compact(). ' +
        'Inspect node_modules/@mariozechner/pi-coding-agent@0.73.1 before continuing.';
      throw new Error(event.error);
    }

    const unsubscribe = (this.session as CompactableSession).subscribe?.((sessionEvent) => {
      if (!isCompactionLifecycleEvent(sessionEvent)) return;
      if (sessionEvent.type === 'compaction_start') {
        event.lifecycle.startObserved = true;
        event.lifecycle.reason = sessionEvent.reason;
        return;
      }
      event.lifecycle.endObserved = true;
      event.lifecycle.reason = sessionEvent.reason;
      event.lifecycle.aborted = sessionEvent.aborted;
      event.lifecycle.willRetry = sessionEvent.willRetry;
    });

    try {
      // No custom summary instruction: the no-op probe must exercise Pi's normal
      // built-in compaction behavior without adding a J-space intervention.
      await compact.call(this.session);
      event.state.messagesAfter = sessionMessageCount(this.session);
      event.state.entriesAfter = sessionEntryCount(this.session);
      event.state.changed = event.state.messagesBefore !== event.state.messagesAfter ||
        event.state.entriesBefore !== event.state.entriesAfter;
      event.status = 'completed';
      event.completedAt = new Date().toISOString();
      this.completedBoundaries.add(boundary);
    } catch (error) {
      event.status = 'failed';
      event.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      unsubscribe?.();
    }
  }
}

function sessionMessageCount(session: unknown): number | null {
  const messages = (session as CompactableSession).agent?.state?.messages;
  return Array.isArray(messages) ? messages.length : null;
}

function sessionEntryCount(session: unknown): number | null {
  const entries = (session as CompactableSession).sessionManager?.getEntries?.();
  return Array.isArray(entries) ? entries.length : null;
}

function isCompactionLifecycleEvent(event: unknown): event is {
  type: 'compaction_start' | 'compaction_end';
  reason: 'manual' | 'threshold' | 'overflow';
  aborted?: boolean;
  willRetry?: boolean;
} {
  if (!event || typeof event !== 'object' || !('type' in event) || !('reason' in event)) return false;
  const candidate = event as { type?: unknown; reason?: unknown };
  return (candidate.type === 'compaction_start' || candidate.type === 'compaction_end') &&
    (candidate.reason === 'manual' || candidate.reason === 'threshold' || candidate.reason === 'overflow');
}
