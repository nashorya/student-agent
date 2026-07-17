# Project Archive Handoff - 2026-07-14

## Branch and baseline

- Branch: `feature/project-archive`
- Design: `docs/superpowers/specs/2026-07-14-project-development-archive-design.md`
- Plan: `docs/superpowers/plans/2026-07-14-project-development-archive.md`

## Implemented

- Restored four environment-corrupted ADR Markdown files and added a real binary regression fixture.
- Added strict UTF-8/NUL checks and SHA-256 source hashes.
- Added archive config, discovery, canonical/conventional readers, lifecycle validation, and safe targeted conventional updates.
- Added the static Project Health HTML renderer with search, filters, accessibility, responsive layout, and escaped project data.
- Added idempotent pending actions and `ArchiveService` with candidate validation and atomic writes.
- Added the `archive_record` Pi tool and feature flag wiring.
- Added `/archive status|init|check|build|adr new|bug open|bug update` in parser, TUI, and readline.
- Added task workflow integration: verified ADRs remain proposed; explicit user acceptance changes them to accepted.
- Replaced `scripts/build-dashboard.ts` with an ArchiveService compatibility wrapper.
- Updated English and Chinese README documentation and generated `docs/dashboard.html`.

## Fresh evidence before handoff

- Targeted archive/integration suite: 73 tests passed before final migration/noise fixes.
- Additional conventional, validation, parser-noise tests passed after those fixes.
- `npm run build` passed after the latest TypeScript changes.
- Repository dashboard build succeeded with 36 timeline entries, 6 ADRs, and 10 bugs.
- Existing accepted ADRs are migration warnings rather than write-blocking errors; new canonical accepted ADRs still require user evidence.

## Remaining tomorrow

1. Run the consolidated targeted suite and full verification from Task 9.
2. Complete Playwright desktop/mobile visual verification. `npx playwright install chromium` was started but intentionally stopped when the user asked to commit and close the session.
3. Review screenshot results and fix any layout/content issue if found.
4. Run `npm run build`, full Vitest, Python unittest, `npm run eval:validate`, and `git diff --check`.
5. Commit any final verification fixes and use the finishing-development-branch workflow.

## Notes

- Do not restore or rewrite unrelated user changes.
- The current dashboard warning about legacy accepted ADRs is intentional adoption behavior.
- The runtime file `memory/archive-actions.json` is ignored.
