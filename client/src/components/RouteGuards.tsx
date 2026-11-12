'use client';

import React, { useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { useRouter } from '../context/RouterContext.tsx';

/**
 * Auth route guards.
 *
 * These were previously defined inline in App.tsx and are now shared between the
 * legacy App.tsx tree and the Next.js App Router route segments. The logic is
 * identical to the original — only the location changed.
 */

export function ProtectedView({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { navigate } = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login', { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="loading loading-spinner loading-md text-cyan-400" />
          <p className="text-xs text-slate-400">Verifying secure session...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}

export function GuestOnlyView({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { navigate } = useRouter();

  useEffect(() => {
    if (!loading && user) {
      navigate('/chat', { replace: true });
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-slate-100 flex items-center justify-center">
        <span className="loading loading-spinner loading-md text-cyan-400" />
      </div>
    );
  }

  if (user) return null;
  return <>{children}</>;
}
