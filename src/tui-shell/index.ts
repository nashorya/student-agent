export { theme, editorTheme, type ThemeToken } from './theme.js';
export {
  initialShellState,
  shellReducer,
  type ActivityKind,
  type ShellAction,
  type ShellAgentRow,
  type ShellMessage,
  type ShellPlanStep,
  type ShellState,
  type CompactOverlay,
} from './state.js';
export {
  WIDE_BREAKPOINT,
  LAYOUT_ACCEPTANCE_WIDTHS,
  isWide,
  describeLayoutRegions,
  rightRailBasis,
  cycleCompactOverlay,
  type LayoutRegion,
  type CompactOverlayKind,
} from './layout.js';
export { createShellBridge, type CreateShellBridgeOptions, type ShellUiBridge } from './bridge.js';
export {
  TranscriptView,
  PlanPanel,
  AgentsPanel,
  CompactOverlayPanel,
  MemoryPanel,
  SidebarSectionGap,
} from './components.js';
export {
  HRule,
  WorkspaceHeader,
  ComposerLabel,
  StatusBar,
  SidebarFrame,
  sectionRailTitle,
  hRule,
  withSidebarRail,
} from './chrome.js';
export {
  projectTaskToPlanSteps,
  projectMainAgentRow,
  sortAgentRowsForTree,
  formatPlanOverlay,
  formatAgentsOverlay,
} from './project-workbench.js';
export {
  formatSignalActivity,
  formatReflectActivity,
  formatRecallActivity,
  buildMemoryOverlaySnapshot,
} from './project-memory.js';
export { syncWorkbenchProjection } from './sync-workbench.js';
export {
  startShell,
  type StartShellOptions,
  type ShellHandle,
} from './shell.js';
export {
  sessionEntriesToSelectItems,
  type SessionPickEntry,
} from './session-picker.js';
