import React from 'react';
import { Toaster } from 'react-hot-toast';
import { RouterProvider, useRouter } from './context/RouterContext.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { ChatRealtimeProvider } from './context/RealtimeContext.tsx';
import { GuestOnlyView, ProtectedView } from './components/RouteGuards.tsx';
import { LandingPage } from './views/LandingPage.tsx';
import {
  ForgotPasswordPage,
  GoogleCallbackPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './views/AuthPages.tsx';
import { ChatWorkspacePage } from './views/ChatWorkspacePage.tsx';
import { ProfileSettingsPage } from './views/ProfileSettingsPage.tsx';
import { NotificationsPage } from './views/NotificationsPage.tsx';
import { AdminDashboardPage } from './views/AdminDashboardPage.tsx';
import { AppErrorBoundary, NotFoundPage } from './views/ErrorPages.tsx';

function RouteSwitch() {
  const { pathname } = useRouter();

  if (pathname === '/') return <LandingPage />;
  if (pathname === '/login') {
    return (
      <GuestOnlyView>
        <LoginPage />
      </GuestOnlyView>
    );
  }
  if (pathname === '/register') {
    return (
      <GuestOnlyView>
        <RegisterPage />
      </GuestOnlyView>
    );
  }
  if (pathname === '/verify-email') return <VerifyEmailPage />;
  if (pathname === '/forgot-password') return <ForgotPasswordPage />;
  if (pathname === '/reset-password') return <ResetPasswordPage />;
  if (pathname === '/auth/google/callback') return <GoogleCallbackPage />;

  if (pathname === '/chat') {
    return (
      <ProtectedView redirectAdminTo="/admin">
        <ChatWorkspacePage forcedMode="ALL" />
      </ProtectedView>
    );
  }
  if (pathname === '/chat/direct') {
    return (
      <ProtectedView redirectAdminTo="/admin">
        <ChatWorkspacePage forcedMode="DIRECT" />
      </ProtectedView>
    );
  }
  if (pathname === '/chat/groups') {
    return (
      <ProtectedView redirectAdminTo="/admin">
        <ChatWorkspacePage forcedMode="GROUP" />
      </ProtectedView>
    );
  }
  if (pathname === '/profile') {
    return (
      <ProtectedView>
        <ProfileSettingsPage />
      </ProtectedView>
    );
  }
  if (pathname === '/notifications') {
    return (
      <ProtectedView>
        <NotificationsPage />
      </ProtectedView>
    );
  }
  if (pathname === '/admin') {
    return (
      <ProtectedView>
        <AdminDashboardPage />
      </ProtectedView>
    );
  }

  return <NotFoundPage />;
}

export default function App({ initialUrl }: { initialUrl?: string } = {}) {
  return (
    <AppErrorBoundary>
      <RouterProvider initialUrl={initialUrl}>
        <AuthProvider>
          <ChatRealtimeProvider>
            <RouteSwitch />
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
          </ChatRealtimeProvider>
        </AuthProvider>
      </RouterProvider>
    </AppErrorBoundary>
  );
}
