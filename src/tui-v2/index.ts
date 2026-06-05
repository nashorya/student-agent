import { ProcessTerminal } from '@earendil-works/pi-tui';
import {
  createPiTUIV2ForTest,
  createPiTUIV2Runtime,
  type TUIV2PiHandle,
} from './pi-runtime.js';
import type { TerminalWriter } from './terminal-control.js';

export type TUIV2Handle = TUIV2PiHandle;

export interface TUIV2StartOptions {
  onSubmit: (value: string) => void;
  onAbort: () => void;
  onExit?: () => void;
}

export function startTUIV2(options: TUIV2StartOptions): TUIV2Handle {
  return createPiTUIV2Runtime({
    terminal: new ProcessTerminal(),
    ...options,
  });
}

export interface TUIV2TestHandle extends TUIV2Handle {
  receiveInput: (chunk: string) => void;
}

type TestTerminalWriter = TerminalWriter & {
  setFrame?: (lines: string[]) => void;
};

export function startTUIV2ForTest(options: TUIV2StartOptions & {
  terminal: TestTerminalWriter;
}): TUIV2TestHandle {
  const handle = createPiTUIV2ForTest({
    columns: options.terminal.columns,
    rows: options.terminal.rows,
    onSubmit: options.onSubmit,
    onAbort: options.onAbort,
    onExit: options.onExit,
  });
  options.terminal.setFrame?.(handle.frame());
  return {
    bridge: handle.bridge,
    receiveInput(data) {
      handle.receiveInput(data);
      options.terminal.setFrame?.(handle.frame());
    },
    waitForExit: handle.waitForExit,
    unmount: handle.unmount,
  };
}
