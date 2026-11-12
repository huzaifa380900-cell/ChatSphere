'use client';

import { useEffect } from 'react';
import { AppErrorScreen } from '../views/ErrorPages.tsx';

/**
 * App Router error boundary.
 *
 * Replaces the manual <AppErrorBoundary> wrapper that used to sit in App.tsx.
 * Next.js catches render errors in this segment (and its children) and renders
 * this component instead of unmounting the whole app.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('ChatSphere route error:', error);
  }, [error]);

  return (
    <AppErrorScreen
      message={error?.message || 'An unexpected rendering error occurred.'}
      onReload={reset}
    />
  );
}
