import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { createBridge, type TUIBridge } from "./bridge.js";
import { redirectConsoleForTUI } from "./console-redirect.js";
import type { AppAction } from "./state.js";

export interface TUIHandle {
  bridge: TUIBridge;
  waitForExit: () => Promise<void>;
  unmount: () => void;
}

export function startTUI(options: {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}): TUIHandle {
  const { onSubmit, onAbort } = options;

  // 关键：劫持 console.* 必须在 ink render 之前，
  // 否则任何在 import 期间或第一帧渲染时打出的日志会污染 ink 屏幕区。
  const restoreConsole = redirectConsoleForTUI();

  let dispatchRef: ((action: AppAction) => void) | null = null;

  const g = globalThis as { __tuiDispatch?: (d: (action: AppAction) => void) => void };
  g.__tuiDispatch = (dispatch) => {
    dispatchRef = dispatch;
  };

  const bridge = createBridge((action) => {
    dispatchRef?.(action);
  });

  const { unmount, waitUntilExit } = render(
    React.createElement(App, { onSubmit, onAbort }),
  );

  return {
    bridge,
    waitForExit: waitUntilExit,
    unmount: () => {
      unmount();
      restoreConsole();
    },
  };
}

export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}
