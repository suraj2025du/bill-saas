import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useAppUpdate } from './shell/appState';
import { installErrorCapture } from './store/errorLog';
import './index.css';

// Unexpected errors go to the local log in Settings > Diagnostics (nothing is sent anywhere).
installErrorCapture();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support: only in the built app, on secure origins (https or localhost),
// and never inside sandboxed previews that refuse service workers.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext && window.top === window.self) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const update = registerSW({
        immediate: true,
        onNeedRefresh() {
          useAppUpdate.setState({ ready: true, apply: () => void update(true) });
          void update(true);
        },
      });
    })
    .catch((e: unknown) => console.warn('Service worker not registered', e));
}
