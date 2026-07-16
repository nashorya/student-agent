# J-space compaction probe integration

This bundle contains:

- `evals/tasks/jspace-compaction-probe-01/`: a complete task fixture
- `scripts/eval-provider-usage-probe.ts`: runnable Pi usage smoke probe
- `src/evals/forced-compaction-controller.ts`: deterministic compaction helper

## 1. Copy the files

Copy the bundle contents into the repository root, preserving paths.

Add an npm script if desired:

```json
"eval:provider-probe": "npx tsx scripts/eval-provider-usage-probe.ts"
```

## 2. Validate the fixture without a model

```bash
npm run eval:validate
```

The reference solution must pass and the untouched environment must fail.

## 3. Run the provider usage probe

```bash
npx tsx scripts/eval-provider-usage-probe.ts   --task-dir evals/tasks/jspace-compaction-probe-01   --keep-sandbox
```

This uses the existing `runStudentAgentEval()` path and records Pi-normalized usage.
It does not yet force compaction.

## 4. Wire forced compaction into `agent-runner.ts`

The repository's pinned Pi API must be checked locally first. The controller deliberately
fails if `session.compact()` is absent.

Minimal integration:

1. Extend `RunStudentAgentEvalOptions`:

```ts
forceCompactionAfterPhases?: number[];
```

2. After `createStudentSession(...)`:

```ts
const compaction = new ForcedCompactionController(
  session,
  new Set(options.forceCompactionAfterPhases ?? []),
);
```

3. Pass `compaction` into `runTaskMode()`.

4. Immediately after a phase is successfully completed, and before prompting the next phase:

```ts
const completedPhaseNumber = active.active_phase_index + 1;
await tasks.completePhase(active.id);

if (compaction.shouldCompactAfterPhase(completedPhaseNumber)) {
  await compaction.compactAfterPhase(completedPhaseNumber);
}

active = await tasks.getActive();
```

5. Add `compactionEvents` to the returned protected trace or a new trace field.

For this fixture use:

```ts
forceCompactionAfterPhases: [2, 4]
```

## 5. Arm isolation

- `plain`: disable existing `buildMemoryPrompt` and any model-side Task Ledger/Recall injection.
- `current`: repository defaults.
- `v0.5`: plain plus checkpoint at compaction.
- `v1`: v0.5 plus deterministic projection.

Write the actual enabled feature manifest into protected trace for every run.

## 6. Probe interpretation

The fixture plants:

- protected first-turn constraints
- a mandatory one-time failed helper route with signature
  `JSPACE_DECOY_LEGACY_SCHEMA_V1`
- a cross-boundary migration decision whose source file must be deleted in Phase 2

Count the decoy signature in tool results before and after forced compaction. A second
post-compaction occurrence is a repeated rejected path.

The test verifier checks final behavior, protected files, the derived migration decision,
and deletion of the one-time source. The leakage manifest defines invalid channels.
