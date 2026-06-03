import React, { useReducer, useEffect } from "react";
import { Box } from "ink";
import { AppStateContext, appReducer, initialAppState } from "./state.js";
import { OutputArea } from "./components/OutputArea.js";
import { StatusBar } from "./components/StatusBar.js";
import { InputLine } from "./components/InputLine.js";

interface AppProps {
  onSubmit: (value: string) => void;
  onAbort: () => void;
}

export function App({ onSubmit, onAbort }: AppProps) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  // 暴露 dispatch 给 bridge
  useEffect(() => {
    const g = globalThis as { __tuiDispatch?: (d: typeof dispatch) => void };
    g.__tuiDispatch?.(dispatch);
  }, [dispatch]);

  return (
    <AppStateContext.Provider value={{ state, dispatch }}>
      <Box flexDirection="column" height="100%">
        <Box flexGrow={1} flexDirection="column">
          <OutputArea />
        </Box>
        <StatusBar />
        <InputLine onSubmit={onSubmit} onAbort={onAbort} />
      </Box>
    </AppStateContext.Provider>
  );
}
