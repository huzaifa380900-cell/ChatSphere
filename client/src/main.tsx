import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/service-worker.js').catch((err: unknown) => {
    console.error('Unable to register ChatSphere service worker.', err);
  });
}

createRoot(document.getElementById('root')!).render(<App />);
