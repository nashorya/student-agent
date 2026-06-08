export const successClaimOnlyTrace = [
  { type: 'assistant_message', message: '完成了，all tests pass' },
];

export const readOnlyTrace = [
  { type: 'tool_call', toolName: 'read_file', path: 'src/app.ts' },
];

export const writeAndValidationTrace = [
  { type: 'tool_call', toolName: 'apply_patch', path: 'src/app.ts' },
  { type: 'tool_call', toolName: 'bash', command: 'npx tsc --noEmit' },
];
