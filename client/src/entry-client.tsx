import { hydrateRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/service-worker.js').catch((err: unknown) => {
    console.error('Unable to register ChatSphere service worker.', err);
  });
}

// SSR: hydrateRoot attaches React to server-rendered HTML
hydrateRoot(
  document.getElementById('root')!,
  <App initialUrl={window.location.pathname + window.location.search} />
);
