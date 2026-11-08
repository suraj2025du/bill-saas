import type { NextFunction, Request, Response } from 'express';
import { CLIENT_HEADER } from '../src/data/http';

/**
 * Content-Security-Policy for the app. External origins are limited to the
 * opt-in Google Drive backup (Google Identity Services + Drive API).
 * 'wasm-unsafe-eval' lets the offline OCR engine (WebAssembly) start.
 * No inline styles: React sets styles through the CSSOM, print @page rules use a
 * constructed stylesheet, and QR codes and barcodes are SVG images.
 * The one hash is the fixed <style> html2canvas-pro adds to its PDF clone to hide
 * pseudo-element placeholders (tests/unit/csp.test.ts recomputes it from the installed
 * package, so an upgrade that changes the text fails the test instead of the PDFs).
 */
export const HTML2CANVAS_STYLE_HASH = "'sha256-UP0QZg7irvSMvOBz9mH2PIIE28+57UiavRfeVea0l3g='";

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com",
  `style-src 'self' ${HTML2CANVAS_STYLE_HASH} https://accounts.google.com`,
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Only answer requests addressed to this machine. Blocks DNS-rebinding attacks,
 * where a web page points its own hostname at 127.0.0.1 to read local data.
 */
export function hostGuard(port: number) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!allowed.has(host)) {
      res.status(403).json({ error: 'Forbidden host.' });
      return;
    }
    next();
  };
}

/**
 * API requests must carry the app's custom header. Browsers never add custom
 * headers to cross-site requests without a CORS preflight, which this server
 * never approves, so another website cannot change or read your data.
 */
export function apiGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' && req.path === '/health') {
    next();
    return;
  }
  if (req.get(CLIENT_HEADER) !== '1') {
    res.status(403).json({ error: 'Missing client header.' });
    return;
  }
  if (req.method !== 'GET' && !req.is('application/json')) {
    res.status(415).json({ error: 'Content-Type must be application/json.' });
    return;
  }
  next();
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
}
