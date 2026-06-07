import type { ProtectedEvalEvent } from "../../evals/types.js";

/**
 * In-process collector for protected eval events.
 *
 * Events are emitted by hashline, signal-pipeline, or toolguard internal
 * logic. They accumulate in a module-scoped array and are drained after each
 * tool call (or eval step) so they can be attached to the eval trace.
 *
 * This module is intentionally singleton-free: tests can import and call the
 * functions directly; the session factory wires them into the tool hooks.
 */

const eventBuffer: ProtectedEvalEvent[] = [];

/**
 * Append a protected eval event. A timestamp is automatically injected
 * if the caller did not supply one.
 */
export function emitProtectedEvent(
    event: Omit<ProtectedEvalEvent, "timestamp"> & Partial<Pick<ProtectedEvalEvent, "timestamp">>,
): void {
    const timestamp = event.timestamp ?? new Date().toISOString();
    eventBuffer.push({ ...event, timestamp } as ProtectedEvalEvent);
}

/**
 * Drain (return and clear) all accumulated protected eval events.
 * Typically called once per tool invocation or eval step so events
 * can be appended to the current trace entry.
 */
export function drainProtectedEvents(): ProtectedEvalEvent[] {
    const events = eventBuffer.splice(0);
    return events;
}