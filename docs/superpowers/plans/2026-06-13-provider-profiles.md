# Provider Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save multiple named provider routes globally and switch the complete provider/model/API/key-reference tuple with `/provider`.

**Architecture:** Extend the config loader so global profile definitions are resolved into the existing runtime `model` shape while project config selects the active profile. Keep profile persistence and interactive selection in a focused setup module, then wire it into both TUI and readline command loops. Existing top-level model configuration and environment-variable eval routes remain compatible.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing Pi model registry and CLI/TUI bridges.

---

### Task 1: Profile-Aware Configuration

**Files:**
- Modify: `src/core/config/types.ts`
- Modify: `src/core/config/loader.ts`
- Test: `src/core/config/__tests__/loader.test.ts`

- [ ] **Step 1: Write failing loader tests**

Add tests proving:

```ts
expect(config.activeProviderProfile).toBe('openrouter-sonnet');
expect(config.model).toMatchObject({
  provider: 'openrouter',
  name: 'anthropic/claude-sonnet-4.6',
  baseUrl: 'https://openrouter.ai/api/v1',
  api: 'openai-completions',
  apiKeyEnv: 'OPENROUTER_API_KEY',
});
```

Also cover project profile selection, `STUDENT_AGENT_PROVIDER_PROFILE`, environment model overrides, local profile definitions being ignored, legacy configuration, and a missing selected profile throwing an actionable error.

- [ ] **Step 2: Verify the tests fail**

Run:

```bash
npx vitest run src/core/config/__tests__/loader.test.ts
```

Expected: failures because profile fields and resolution do not exist.

- [ ] **Step 3: Add profile types and loader resolution**

Add:

```ts
export interface ProviderProfile extends StudentAgentModelInput {
  provider: StudentAgentProvider;
  name: string;
  apiKeyEnv?: string;
}
```

Extend config input/output with `activeProviderProfile` and
`providerProfiles`. Load global and local files separately so only global
profile definitions are accepted. Resolve the selected profile before applying
the local legacy model and environment model overrides.

- [ ] **Step 4: Verify focused tests pass**

Run:

```bash
npx vitest run src/core/config/__tests__/loader.test.ts
npx tsc --noEmit
```

Expected: all loader tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/types.ts src/core/config/loader.ts src/core/config/__tests__/loader.test.ts
git commit -m "feat(config): resolve named provider profiles"
```

### Task 2: Profile Persistence And Selection Helpers

**Files:**
- Create: `src/core/setup/provider-profiles.ts`
- Create: `src/core/setup/__tests__/provider-profiles.test.ts`
- Modify: `src/core/setup/initializer.ts`
- Test: `src/core/setup/__tests__/initializer.test.ts`

- [ ] **Step 1: Write failing helper tests**

Cover:

```ts
expect(formatProviderProfiles(config)).toContain('openrouter-sonnet');
expect(await selectProviderProfile({ config, answer: '2', ...deps }))
  .toMatchObject({ selected: true, profileName: 'anthropic-direct' });
expect(updated.providerProfiles?.first.name).toBe('model-a');
expect(updated.providerProfiles?.second.name).toBe('new-model-b');
```

Also verify invalid names, missing key variables, cancellation, preserving
unrelated profiles, and project selection writing only
`activeProviderProfile`.

- [ ] **Step 2: Verify helper tests fail**

Run:

```bash
npx vitest run src/core/setup/__tests__/provider-profiles.test.ts
```

Expected: module-not-found or missing export failures.

- [ ] **Step 3: Implement pure helpers and persistence**

Create helpers that:

- Validate profile names with `/^[a-z0-9][a-z0-9._-]*$/`.
- Render the numbered profile menu.
- Resolve a numbered or named selection.
- Validate provider, model, and referenced API key before persistence.
- Merge a profile into global JSON without replacing other profiles.
- Write current-project `activeProviderProfile`.
- Update only the active profile's model.

Export the existing JSON update helper from `initializer.ts` or move the
generic JSON merge into the new module without changing unrelated setup
behavior.

- [ ] **Step 4: Update setup and `/model` persistence**

Change model/provider setup to ask for a profile name, derive the default API
key variable from the provider, persist the profile globally, and select it for
the current project. Change `switchModelName` so an active profile updates that
profile instead of the legacy top-level model.

- [ ] **Step 5: Verify focused tests pass**

Run:

```bash
npx vitest run src/core/setup/__tests__/provider-profiles.test.ts src/core/setup/__tests__/initializer.test.ts
npx tsc --noEmit
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/setup/provider-profiles.ts src/core/setup/__tests__/provider-profiles.test.ts src/core/setup/initializer.ts src/core/setup/__tests__/initializer.test.ts
git commit -m "feat(setup): persist provider profiles"
```

### Task 3: `/provider` Command And Runtime Switching

**Files:**
- Modify: `src/cli/command-parser.ts`
- Modify: `src/cli/__tests__/command-parser.test.ts`
- Modify: `src/extension/index.ts`
- Create: `src/extension/__tests__/provider-command.test.ts`

- [ ] **Step 1: Write failing command tests**

Add:

```ts
expect(parseCommand('/provider')).toEqual({ type: 'provider' });
expect(COMMAND_COMPLETIONS).toContain('/provider');
expect(getHelpText()).toContain('/provider');
```

For the profile flow, test a small exported coordinator with injected prompt,
config writer, key lookup, and reload callbacks. Verify cancellation leaves the
runtime/config untouched, while a valid selection writes the project selection
and reloads the chosen provider/model.

- [ ] **Step 2: Verify command tests fail**

Run:

```bash
npx vitest run src/cli/__tests__/command-parser.test.ts src/extension/__tests__/provider-command.test.ts
```

Expected: `/provider` is unknown and the coordinator does not exist.

- [ ] **Step 3: Implement command parsing and switching flow**

Add `{ type: 'provider' }`, completion, and help text. Add a shared interactive
profile-switch function that:

1. Lists profiles with the active marker.
2. Accepts a number or profile name.
3. Validates the selected profile and API key before writing.
4. Persists project `activeProviderProfile`.
5. Reloads and recreates the runtime.

Wire it into both TUI and readline switch statements. Block switching while the
agent is streaming.

- [ ] **Step 4: Resolve authentication through the profile key reference**

Change runtime startup and missing-key diagnostics to use:

```ts
const apiKeyEnvName =
  config.model.apiKeyEnv ?? getApiKeyEnvName(config.model.provider);
```

Do not change eval environment override behavior.

- [ ] **Step 5: Verify focused tests pass**

Run:

```bash
npx vitest run src/cli/__tests__/command-parser.test.ts src/extension/__tests__/provider-command.test.ts
npx tsc --noEmit
```

Expected: focused tests and type checking pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/command-parser.ts src/cli/__tests__/command-parser.test.ts src/extension/index.ts src/extension/__tests__/provider-command.test.ts
git commit -m "feat(cli): switch named provider profiles"
```

### Task 4: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`

- [ ] **Step 1: Document profiles and compatibility**

Add the global JSON schema, `.env` key example, `/provider` behavior,
`/setting` creation flow, `/model` isolation, and
`STUDENT_AGENT_PROVIDER_PROFILE` override. State that legacy top-level `model`
configuration remains supported.

- [ ] **Step 2: Run focused and full verification**

Run:

```bash
npx tsc --noEmit
npx vitest run
```

Expected: TypeScript passes and all tests are green.

- [ ] **Step 3: Review the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended documentation/code/test files.

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh.md
git commit -m "docs: explain provider profiles"
```
