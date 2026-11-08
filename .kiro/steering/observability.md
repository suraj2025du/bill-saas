# OBSERVABILITY STEERING

## Stack
- **Errors** — Sentry (`getsentry/sentry`).
- **Metrics + logs** — Prometheus (`prometheus/prometheus`) + Grafana, or OpenObserve (`openobserve/openobserve`).
- **Uptime** — smoke tests on a schedule hitting prod health endpoints.
- **Perf / A11y budgets** — Lighthouse CI thresholds enforced in `e2e.yml`.

## Policy
- Every service ships with a dashboard + alert rules before it is called "done".
- `heal:nightly` task re-runs scanners + smoke tests, opens fix tasks for new findings, updates reports.
- Alerts route to a real channel; no silent dashboards.
