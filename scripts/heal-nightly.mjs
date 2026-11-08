// npm run heal:nightly - re-run every gate (lint, types, tests with the coverage gate, build,
// end-to-end tests, dependency audit, and the security scanners that are installed) and write
// security-reports/nightly-<date>.md. Exits 1 when a gate fails, so CI can open a fix task.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const has = (tool) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [tool], { stdio: 'ignore' }).status === 0;

const steps = [
  ['Lint', 'npm run lint'],
  ['Typecheck', 'npm run typecheck'],
  // Two workers keep memory use low on an ordinary office PC; the suite takes seconds anyway.
  ['Unit + integration tests (80% coverage gate)', 'npm run coverage -- --maxWorkers=2'],
  ['Build', 'npm run build'],
  ['End-to-end tests (Playwright)', 'npx playwright test'],
  ['Production dependencies (npm audit)', 'npm audit --omit=dev --audit-level=moderate'],
];
const skipped = [];
const optional = [
  ['gitleaks', 'Secrets (gitleaks)', 'gitleaks dir . --redact --no-banner'],
  ['osv-scanner', 'Dependencies (OSV-Scanner)', 'osv-scanner scan source -r .'],
  ['trivy', 'Dependencies (Trivy)', 'trivy fs --scanners vuln --severity MEDIUM,HIGH,CRITICAL --exit-code 1 --skip-version-check .'],
  ['semgrep', 'Static analysis (Semgrep)', 'semgrep scan --config p/default --error --exclude public/ocr --exclude dist --exclude dist-server'],
];
for (const [tool, label, cmd] of optional) {
  if (has(tool)) steps.push([label, cmd]);
  else skipped.push(`${label}: ${tool} is not installed`);
}

const results = [];
for (const [label, cmd] of steps) {
  console.info(`\n== ${label}: ${cmd}`);
  const started = Date.now();
  const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(output.split('\n').slice(-15).join('\n'));
  results.push({ label, cmd, ok: r.status === 0, seconds: Math.round((Date.now() - started) / 1000), tail: output.split('\n').slice(-40).join('\n') });
}

const day = new Date().toISOString().slice(0, 10);
const failed = results.filter((r) => !r.ok);
const lines = [
  `# Nightly check ${day}`,
  '',
  failed.length ? `**${failed.length} gate(s) failed.** Fix them before the next release.` : '**All gates passed.**',
  '',
  '| Gate | Result | Time |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.label} | ${r.ok ? 'pass' : '**FAIL**'} | ${r.seconds} s |`),
  '',
  ...(skipped.length ? ['Not run:', ...skipped.map((s) => `- ${s}`), ''] : []),
  ...failed.flatMap((r) => [`## ${r.label} failed`, '', `\`${r.cmd}\``, '', '```text', r.tail.trim(), '```', '']),
];
mkdirSync(join(root, 'security-reports'), { recursive: true });
const report = join(root, 'security-reports', `nightly-${day}.md`);
writeFileSync(report, `${lines.join('\n')}\n`);
console.info(`\n${failed.length ? `${failed.length} gate(s) failed` : 'All gates passed'}. Report: ${report}`);
process.exit(failed.length ? 1 : 0);
