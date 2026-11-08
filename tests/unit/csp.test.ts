import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CSP, HTML2CANVAS_STYLE_HASH } from '../../server/security';

/** The <style> text html2canvas-pro injects into its clone, rebuilt from the installed package. */
function html2canvasHideStyle(): string {
  const src = readFileSync(fileURLToPath(new URL('../../node_modules/html2canvas-pro/dist/html2canvas-pro.esm.js', import.meta.url)), 'utf8');
  const constant = (name: string) => {
    const m = new RegExp(`const ${name} = (["\`])([\\s\\S]*?)\\1;`).exec(src);
    if (!m) throw new Error(`html2canvas-pro no longer defines ${name}`);
    return m[2];
  };
  const template = /createStyles\(body, `([\s\S]*?)`, cspNonce\)/.exec(src);
  if (!template) throw new Error('html2canvas-pro no longer builds the pseudo-element hide style the same way');
  return template[1].replace(/\$\{(\w+)\}/g, (_, name: string) => constant(name));
}

describe('Content-Security-Policy', () => {
  it('allows no inline styles or scripts', () => {
    expect(CSP).not.toContain("'unsafe-inline'");
    expect(CSP).not.toContain("'unsafe-eval'");
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).toContain("frame-ancestors 'none'");
  });

  it("allows exactly the style html2canvas-pro adds for PDF export (re-check after upgrading it)", () => {
    const hash = `'sha256-${createHash('sha256').update(html2canvasHideStyle(), 'utf8').digest('base64')}'`;
    expect(hash).toBe(HTML2CANVAS_STYLE_HASH);
    expect(CSP).toContain(`style-src 'self' ${HTML2CANVAS_STYLE_HASH}`);
  });
});
