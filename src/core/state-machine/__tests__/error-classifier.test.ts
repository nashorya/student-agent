import { describe, expect, it } from 'vitest';
import { classifyError } from '../error-classifier.js';

describe('classifyError', () => {
  it('classifies write ENOENT as write-parent-missing', () => {
    const classified = classifyError(
      new Error("ENOENT: no such file or directory, open 'src/missing/file.ts'"),
      'write_file',
    );

    expect(classified.category).toBe('tool');
    expect(classified.subtype).toBe('write-parent-missing');
  });

  it('keeps read ENOENT as resource-not-found', () => {
    const classified = classifyError(
      new Error("ENOENT: no such file or directory, open 'src/missing/file.ts'"),
      'read_file',
    );

    expect(classified.category).toBe('tool');
    expect(classified.subtype).toBe('resource-not-found');
  });
});
