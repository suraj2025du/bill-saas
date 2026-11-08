/**
 * Optional Google Drive backup with the user's own OAuth Client ID (Google
 * Identity Services token flow, scope drive.file: the app only sees files it
 * created). Nothing is sent to Google unless the user turns this on.
 */
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void;
}

interface GoogleAccounts {
  oauth2: {
    initTokenClient(config: {
      client_id: string;
      scope: string;
      callback: (resp: TokenResponse) => void;
      error_callback?: (err: { type?: string; message?: string }) => void;
    }): TokenClient;
  };
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Free GST Billing';
let gisLoading: Promise<void> | null = null;
let cached: { clientId: string; token: string; expires: number } | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisLoading = null;
        reject(new Error('Could not load Google sign-in. Check the internet connection.'));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

export function isValidClientId(id: string): boolean {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id.trim());
}

export async function driveToken(clientId: string): Promise<string> {
  if (cached && cached.clientId === clientId && cached.expires > Date.now() + 60_000) return cached.token;
  if (!isValidClientId(clientId)) throw new Error('The OAuth Client ID looks wrong. It ends with .apps.googleusercontent.com');
  await loadGis();
  const google = window.google;
  if (!google) throw new Error('Google sign-in did not start.');
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Google did not give access.'));
          return;
        }
        cached = { clientId, token: resp.access_token, expires: Date.now() + (resp.expires_in ?? 3600) * 1000 };
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err.message || 'Google sign-in was closed.')),
    });
    client.requestAccessToken({ prompt: cached ? '' : 'consent' });
  });
}

async function api<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 401) cached = null;
    const body = await res.text().catch(() => '');
    throw new Error(`Google Drive error ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function ensureFolder(token: string, knownId: string): Promise<string> {
  if (knownId) {
    try {
      const f = await api<{ id: string; trashed?: boolean }>(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(knownId)}?fields=id,trashed`);
      if (!f.trashed) return f.id;
    } catch {
      // folder gone: create a new one
    }
  }
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`);
  const found = await api<{ files: { id: string }[] }>(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
  if (found.files[0]) return found.files[0].id;
  const created = await api<{ id: string }>(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return created.id;
}

export async function uploadFile(token: string, folderId: string, name: string, blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, parents: [folderId] })], { type: 'application/json' }));
  form.append('file', blob, name);
  const res = await api<{ id: string }>(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
  return res.id;
}
