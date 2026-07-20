Fix the bug so that `node tests/run.mjs` exits 0.

The project is a tiny client over `src/api.cjs`.

Requirements:

1. Run `node tests/run.mjs` first and observe the failure.
2. Fix **only** `src/client.cjs` (do not rewrite `src/api.cjs` or the test).
3. Re-run `node tests/run.mjs` until it passes.
4. Keep the public API of `src/api.cjs` unchanged.

Hint: the client may be calling a method that does not exist on the API.
