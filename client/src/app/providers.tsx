'use client';

import { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '../context/AuthContext.tsx';
import { ChatSocketProvider } from '../context/ChatSocketContext.tsx';
import { NextRouterProvider } from '../context/RouterContext.tsx';

/**
 * Registers the ChatSphere service worker.
 *
 * This used to live in main.tsx / entry-client.tsx under Vite. Under the App
 * Router there is no manual entry file, so registration happens in an effect
 * after hydration — same behaviour, same asset path (/service-worker.js is
 * served from client/public).
 */
function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/service-worker.js').catch((err: unknown) => {
        console.error('Unable to register ChatSphere service worker.', err);
      });
    }
  }, []);

  return null;
}

/**
 * Client provider boundary.
 *
 * AuthProvider owns the session (it reads /auth/me with httpOnly cookies) and
 * ChatSocketProvider owns the Socket.IO connection. Both are inherently
 * client-side, so they are mounted here once for the whole app instead of in
 * every route.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <NextRouterProvider>
      <AuthProvider>
        <ChatSocketProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: '#111827',
                color: '#F8FAFC',
                border: '1px solid #1E293B',
                fontSize: '13px',
              },
            }}
          />
          <ServiceWorkerRegistrar />
        </ChatSocketProvider>
      </AuthProvider>
    </NextRouterProvider>
  );
}
