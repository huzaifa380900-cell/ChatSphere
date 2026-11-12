'use client';

import React from 'react';
import { AlertTriangle, Compass } from 'lucide-react';
import { AppLink } from '../context/RouterContext.tsx';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-base-100 text-base-content flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-base-200 border border-base-300 rounded-xl p-8 text-center space-y-5">
        <Compass className="w-11 h-11 text-primary mx-auto" />
        <div className="space-y-1.5">
          <p className="text-xs font-mono text-primary font-semibold">HTTP 404</p>
          <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
          <p className="text-sm text-base-content/70">
            The route you requested does not exist or may have moved.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3 pt-2">
          <AppLink href="/" className="btn btn-sm btn-ghost">
            Landing Page
          </AppLink>
          <AppLink href="/chat" className="btn btn-sm btn-primary">
            Open Chat Dashboard
          </AppLink>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared "Application error" screen.
 *
 * Extracted verbatim from AppErrorBoundary so the Next.js App Router error
 * boundary (app/error.tsx) renders the exact same UI.
 */
export function AppErrorScreen({
  message,
  onReload,
}: {
  message: string;
  onReload?: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#111827] border border-slate-800 rounded-xl p-8 text-center space-y-5">
        <AlertTriangle className="w-11 h-11 text-amber-400 mx-auto" />
        <div className="space-y-1.5">
          <h1 className="text-xl font-bold text-white">Application error</h1>
          <p className="text-sm text-slate-400">{message}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onReload?.();
            window.location.href = '/';
          }}
          className="px-5 py-2.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-sm cursor-pointer"
        >
          Reload Application
        </button>
      </div>
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <AppErrorScreen
          message={this.state.message}
          onReload={() => this.setState({ hasError: false, message: '' })}
        />
      );
    }

    return this.props.children;
  }
}
