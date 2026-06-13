# Provider Profiles Design

## Goal

Student Agent currently has one active provider configuration. Reconfiguring a
custom endpoint overwrites the previous provider, base URL, API format, model,
and API key selection.

Add named provider profiles so users can save multiple complete model routes and
switch between them with `/provider`.

## Scope

This change includes:

- Globally saved, named provider profiles.
- A project-level selection of the active profile.
- `/provider` for listing and switching profiles.
- `/setting` for creating or replacing profiles.
- `/model` for changing the model stored in the active profile.
- Backward compatibility with the existing top-level `model` configuration.
- Environment-variable overrides for eval and automation workflows.

This change does not include:

- Automatic failover between profiles.
- Cost-based or task-based routing.
- Load balancing.
- Storing API key values in JSON.
- Deleting or renaming profiles from the first version.

## Configuration Schema

Provider definitions live in the global
`~/.student-agent/.student-agent.json`:

```json
{
  "activeProviderProfile": "openrouter-sonnet",
  "providerProfiles": {
    "openrouter-sonnet": {
      "provider": "openrouter",
      "name": "anthropic/claude-sonnet-4.6",
      "baseUrl": "https://openrouter.ai/api/v1",
      "api": "openai-completions",
      "apiKeyEnv": "OPENROUTER_API_KEY"
    },
    "anthropic-direct": {
      "provider": "anthropic",
      "name": "claude-sonnet-4-6",
      "api": "anthropic-messages",
      "apiKeyEnv": "ANTHROPIC_API_KEY"
    }
  }
}
```

API key values remain in `~/.student-agent/.env`. A profile stores only the
environment variable name used to resolve its key.

A project `.student-agent.json` may set only:

```json
{
  "activeProviderProfile": "anthropic-direct"
}
```

Projects may still use the legacy top-level `model` object for compatibility,
but profile definitions are global-only. Local `providerProfiles` entries are
ignored so a repository cannot silently redefine a user's trusted endpoint or
key reference.

## Resolved Runtime Configuration

The public `StudentAgentConfig.model` shape remains the resolved model route used
by the runtime. New configuration fields are:

- `activeProviderProfile?: string`
- `providerProfiles: Record<string, ProviderProfile>`
- `model.apiKeyEnv?: string`

The loader resolves configuration in this order:

1. Built-in defaults.
2. Global legacy `model`.
3. Selected global provider profile.
4. Project legacy `model`.
5. Environment variables.

The selected profile name uses this order:

1. `STUDENT_AGENT_PROVIDER_PROFILE`
2. Project `activeProviderProfile`
3. Global `activeProviderProfile`

Environment variables remain the highest-priority runtime override. Existing
eval commands that set `STUDENT_AGENT_PROVIDER`, `STUDENT_AGENT_MODEL`,
`STUDENT_AGENT_BASE_URL`, and `STUDENT_AGENT_API` continue to work without
creating or mutating profiles.

If no profile is selected, the loader preserves current behavior and resolves
the legacy top-level `model` configuration.

## API Key Resolution

When a profile is active, runtime authentication uses the profile's
`apiKeyEnv`. When no profile is active, it uses the existing
`getApiKeyEnvName(provider)` mapping.

The runtime must fail with a clear message when:

- `activeProviderProfile` names a missing profile.
- The selected profile has an empty provider or model.
- The selected profile's API key environment variable is missing.

It must not silently switch to another profile or provider.

## Commands

### `/provider`

`/provider` opens a numbered list containing:

- Profile name.
- Provider.
- Model.
- Active marker.

Selecting a profile:

1. Writes `activeProviderProfile` to the project `.student-agent.json`.
2. Reloads configuration and environment.
3. Recreates the runtime using the selected profile.
4. Displays the selected profile and resolved provider/model.

An empty answer cancels without changing configuration.

### `/setting`

The model/provider setup flow asks for a profile name before provider details.
The default name is derived from the provider and model but can be edited.

Saving setup:

- Adds or replaces that profile in the global JSON file.
- Writes the API key value to the global `.env` under the profile's
  `apiKeyEnv`.
- Makes the profile active globally.
- Selects it for the current project.

Replacing an existing profile requires an explicit confirmation in the
interactive flow.

### `/model`

When a profile is active, `/model` updates only the `name` field of that global
profile. Other profiles remain unchanged.

When no profile is active, `/model` keeps its legacy behavior and updates the
top-level model name.

## Legacy Migration

No eager file migration runs at startup.

The first successful `/setting` save creates a named profile while retaining
the legacy `model` object. This makes rollback possible and avoids rewriting
working user configuration merely by launching the CLI.

Users with an existing configuration can continue using Student Agent without
creating a profile. `/provider` reports that no profiles exist and directs them
to `/setting`.

## Modules

- `src/core/config/types.ts`
  - Add `ProviderProfile`, profile map, active profile, and resolved key field.
- `src/core/config/loader.ts`
  - Read global profiles, accept project profile selection, and resolve the
    active profile with environment overrides.
- `src/core/setup/provider-profiles.ts`
  - Pure helpers for listing, selecting, validating, and updating profiles.
- `src/core/setup/initializer.ts`
  - Save provider setup into a named profile and update `/model` within the
    active profile.
- `src/cli/command-parser.ts`
  - Parse `/provider` and expose it in help/completions.
- `src/extension/index.ts`
  - Run the profile picker, reload runtime, and resolve authentication through
    `model.apiKeyEnv`.

## Error Handling

- Invalid profile names are rejected. Names use lowercase letters, digits,
  dots, underscores, and hyphens.
- Selecting a missing profile produces an actionable error and leaves the
  current runtime intact.
- A failed runtime reload does not persist a different active project profile.
  Selection validates the profile and key before writing.
- JSON parse failures retain the existing loader behavior and surface the
  original error.

## Testing

Configuration tests:

- Global profile resolves into `config.model`.
- Project selection overrides global active profile.
- Environment variables override the selected profile.
- Local profile definitions cannot replace global definitions.
- Legacy configuration behaves unchanged.
- Missing profile and missing key errors are explicit.

Profile helper tests:

- Listing marks the active profile.
- Switching writes only the selected profile name.
- Updating one profile's model leaves other profiles unchanged.
- Saving a new profile preserves existing profiles.

CLI tests:

- `/provider` parses and appears in completions/help.
- Empty selection cancels.
- Successful selection reloads the selected provider/model.

Setup tests:

- New custom setup writes a named global profile and API key env reference.
- Existing profile replacement requires confirmation.
- `/model` updates the active profile only.

Run `npx tsc --noEmit` and `npx vitest run` before completion.

## Acceptance Criteria

- Two or more custom provider profiles can coexist in the global JSON file.
- `/provider` switches the complete route without asking for credentials again.
- Switching back restores the previous provider, API, base URL, key reference,
  and model.
- `/model` does not overwrite another profile.
- Existing single-provider installations continue to start unchanged.
- Existing eval environment-variable commands remain unchanged.
- API key values are never written to JSON.
