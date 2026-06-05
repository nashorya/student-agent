import { fitLine } from './status.js';
import type { TUIV2TaskPanelState } from '../state.js';

export function renderTaskPanelLines(
  taskPanel: TUIV2TaskPanelState | null,
  width: number,
): string[] {
  if (!taskPanel || (!taskPanel.name && !taskPanel.state)) return [];

  const segments = [
    taskPanel.name ? `[${taskPanel.name}]` : '[task]',
    formatPhase(taskPanel),
    taskPanel.workflowStatus,
    taskPanel.state,
    formatRetry(taskPanel.retryCount),
    formatToolCalls(taskPanel.toolCallCount),
  ].filter((segment): segment is string => Boolean(segment));

  const lines = [fitLine(segments.join(' · '), width)];
  const reviewLine = formatReviewLine(taskPanel);
  if (reviewLine) lines.push(fitLine(reviewLine, width));
  return lines;
}

function formatPhase(taskPanel: TUIV2TaskPanelState): string | null {
  if (taskPanel.phaseIndex === undefined || taskPanel.totalPhases === undefined) return null;
  return `P${taskPanel.phaseIndex + 1}/${taskPanel.totalPhases}`;
}

function formatRetry(retryCount: number | undefined): string | null {
  return retryCount && retryCount > 0 ? `retry ${retryCount}` : null;
}

function formatToolCalls(toolCallCount: number | undefined): string | null {
  return toolCallCount && toolCallCount > 0 ? `tools ${toolCallCount}` : null;
}

function formatReviewLine(taskPanel: TUIV2TaskPanelState): string | null {
  const markers = [
    taskPanel.requiresVisualReview ? 'visual review required' : null,
    taskPanel.requiresUserAcceptance ? 'user acceptance required' : null,
  ].filter((marker): marker is string => Boolean(marker));
  if (markers.length === 0) return null;
  return `review · ${markers.join(' · ')}`;
}
