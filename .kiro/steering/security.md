# SECURITY STEERING

## Scanner stack (install per project, user-approved)
| Layer | Tool | Purpose |
|---|---|---|
| SAST | Semgrep (`semgrep/semgrep`) | static code vuln patterns |
| Secrets | Gitleaks (`gitleaks/gitleaks`) + detect-secrets (`Yelp/detect-secrets`) | leaked credentials |
| Dependencies | OSV-Scanner (`google/osv-scanner`) + Trivy (`aquasecurity/trivy`) | known CVEs in deps/images |
| DAST | OWASP ZAP (`zaproxy/zaproxy`) + Nuclei (`projectdiscovery/nuclei`) | live app testing |
| Standards | OWASP Cheat Sheet Series (`owasp/Cheat-Sheet-Series`) | Top-10 / ASVS L2 reference |

## Policy
- Every feature gets a STRIDE threat model entry in `design.md`.
- Severity >= medium findings block merge until fixed or explicitly risk-accepted (documented).
- `security.yml` CI workflow runs: semgrep + gitleaks + osv-scanner + trivy + zap-baseline.
- Regenerate `SECURITY_REPORT.md` on every PR and before every deploy.

## Note
These tools *assist* compliance. They are not a certification. Verify versions/licenses
live at install time — do not trust a cached list.
