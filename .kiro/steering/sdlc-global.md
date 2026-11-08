# GLOBAL STEERING — AUTO-APPLY FULL-SDLC PIPELINE

> Scope: applies to EVERY session and EVERY new project opened in this workspace.
> This file is a *policy*, not an installer. Tool installs and MCP servers are
> user-approved actions — see `devops.md` and the INSTALL_MANIFEST.

## Lifecycle every project follows
1. **Plan** — write `requirements.md` (EARS notation) + `design.md` (STRIDE threat model + data-flow) + `tasks.md` (Definition-of-Done).
2. **Scaffold** — start from the `sdlc-scaffold` skill skeleton (`$sdlc-scaffold`; existing repos: `$sdlc-apply`); never hand-roll CI/security files.
3. **Code** — typed, clean-architecture, lint-on-save.
4. **Test** — unit + integration + E2E; coverage gate >= 80%.
5. **Secure** — SAST + secrets + dependency + DAST scans must be clean before merge.
6. **Pay (if applicable)** — enforce `payments-pci.md` controls; block merge if any control missing.
7. **Deploy** — IaC + CI/CD; rollback plan written before prod.
8. **Observe** — error tracking + metrics + uptime + perf/a11y budgets; nightly self-heal scan.

## Definition of Done (DoD)
A task is DONE only when: tests green + scanners clean + docs updated + rollback path exists.

## Gaps / capability needs
When a new capability is needed, evaluate GitHub candidates with:
- stars high for its category OR top of trending this month (judge relative to category, not a fixed number)
- last push <= 90 days, repo not archived
- permissive license (MIT / Apache-2.0 / BSD)
- official / org-maintained preferred

Record every chosen tool in `INSTALL_MANIFEST.json` with its exact uninstall command.

## Hard rules
- Secrets live only in a git-ignored `.env`; never commit them.
- Tool installs and MCP server registration are USER-approved steps, not silent agent actions.
- Scanners run against a real repo; this workspace root is config/policy only.
