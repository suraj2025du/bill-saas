# DEVOPS STEERING

## Stack
- **IaC** — Terraform (`hashicorp/terraform`) and/or docker-compose for local.
- **CI** — GitHub Actions, seeded from `actions/starter-workflows`.
- **CD** — ArgoCD (`argoproj/argo-cd`) GitOps patterns; preview envs per PR.
- **Rollback** — every deploy writes a documented, tested rollback path first.

## CI workflows to generate per project
- `build-test.yml` — build + unit/integration + coverage gate.
- `security.yml` — semgrep + gitleaks + osv-scanner + trivy + zap-baseline.
- `e2e.yml` — Playwright on PR; full suite pre-deploy.
- `deploy.yml` — staging on merge-to-main, prod on manual approval.

## Install discipline (USER-approved)
- Pin versions. Record each install in `INSTALL_MANIFEST.json` with uninstall command.
- MCP servers (docker/npx based) need the user's Docker + tokens; the agent does not auto-start them.
