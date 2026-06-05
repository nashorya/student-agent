import { describe, it } from 'vitest';

describe.skip('OpenTUI spike', () => {
  it('requires Bun or a Node runtime with node:ffi enabled', async () => {
    const { createTestRenderer } = await import('@opentui/core/testing');
    const { BoxRenderable, TextareaRenderable, TextRenderable } = await import('@opentui/core');

    const app = await createTestRenderer({
      width: 40,
      height: 8,
      useThread: false,
      screenMode: 'main-screen',
      targetFps: Number.POSITIVE_INFINITY,
    });

    try {
      const root = new BoxRenderable(app.renderer, {
        width: '100%',
        height: '100%',
        flexDirection: 'column',
      });
      const transcript = new TextRenderable(app.renderer, {
        content: '> hello\nAssistant: streaming',
        width: '100%',
        flexGrow: 1,
      });
      const status = new TextRenderable(app.renderer, {
        content: 'student-agent · ready',
        width: '100%',
        height: 1,
      });
      const input = new TextareaRenderable(app.renderer, {
        width: '100%',
        height: 1,
        wrapMode: 'none',
        placeholder: '> ',
      });

      root.add(transcript);
      root.add(status);
      root.add(input);
      app.renderer.root.add(root);
      input.focus();

      await app.mockInput.typeText('你好 abc');
      await app.renderOnce();
    } finally {
      app.renderer.destroy();
    }
  });
});
