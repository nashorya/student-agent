export { SnapshotManager } from './snapshot.js';
export { classify, HIGH_RISK_TOOL_PATTERN, HIGH_RISK_TOOL_DESTROY_PATTERN, HIGH_RISK_BASH_PATTERNS } from './risk-classifier.js';
export { AlwaysAllowProvider, LogAndDenyProvider, PromptConfirmationProvider, parseConfirmationAnswer } from './confirmation.js';
export { ToolExecutionError, UserAbortError } from './types.js';
export type { ExecutorTool, ToolResult, ConfirmationDecision, ConfirmationProvider, RiskLevel } from './types.js';
