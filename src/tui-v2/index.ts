import {
  createOpenTUIV2Runtime,
  type OpenTUIV2Handle,
} from './opentui-runtime.js';

export type TUIV2Handle = OpenTUIV2Handle;

export interface TUIV2StartOptions {
  onSubmit: (value: string) => void;
  onAbort: () => void;
  onExit?: () => void;
}

export function startTUIV2(options: TUIV2StartOptions): TUIV2Handle {
  return createOpenTUIV2Runtime(options);
}
