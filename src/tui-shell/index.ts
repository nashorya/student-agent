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
} from './state.js';
export {
  WIDE_BREAKPOINT,
  isWide,
  describeLayoutRegions,
  rightRailBasis,
  type LayoutRegion,
} from './layout.js';
export { createShellBridge, type CreateShellBridgeOptions, type ShellUiBridge } from './bridge.js';
export {
  TranscriptView,
  StatusBar,
  PlanPanel,
  AgentsPanel,
} from './components.js';
export {
  startShell,
  type StartShellOptions,
  type ShellHandle,
} from './shell.js';
