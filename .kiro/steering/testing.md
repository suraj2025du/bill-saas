# TESTING STEERING

## Layers
- **Unit** — Vitest (`vitest-dev/vitest`) for JS/TS, pytest (`pytest-dev/pytest`) for Python.
- **Integration** — service + DB level, run in CI with ephemeral containers.
- **E2E** — Playwright (`microsoft/playwright`).
- **API** — Bruno (`usebruno/bruno`) or Hoppscotch (`hoppscotch/hoppscotch`) collections, versioned in repo.
- **Perf / A11y** — Lighthouse (`GoogleChrome/lighthouse`) budgets + axe-core (`dequelabs/axe-core`).

## Gates
- Coverage >= 80% (lines + branches) or the build fails.
- No skipped/`.only` tests in main.
- E2E smoke suite runs on every PR; full E2E before prod deploy.
- `TEST_REPORT.md` regenerated on each PR.
