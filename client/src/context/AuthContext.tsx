'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { apiClient, ensureCsrfToken, resetCsrfTokenCache } from '../lib/api.ts';
import type { AuthUser, UserSettings } from '../types/models.ts';

interface AuthContextValue {
  user: AuthUser | null;
  sessionId: string | null;
  loading: boolean;
  theme: 'dark' | 'light';
  setThemePreference: (theme: 'dark' | 'light') => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
  setAuthenticatedUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      theme === 'light' ? 'chatsphere-light' : 'chatsphere'
    );
  }, [theme]);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      await ensureCsrfToken();
      const res = await apiClient.get<{
        success: boolean;
        data: { user: AuthUser; sessionId: string };
      }>('/auth/me');
      const fetched = res.data.data.user;
      setUser(fetched);
      setSessionId(res.data.data.sessionId);
      if (fetched.settings?.theme === 'light' || fetched.settings?.theme === 'dark') {
        setTheme(fetched.settings.theme);
      }
      return fetched;
    } catch {
      setUser(null);
      setSessionId(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const setAuthenticatedUser = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
    if (nextUser.settings?.theme === 'light' || nextUser.settings?.theme === 'dark') {
      setTheme(nextUser.settings.theme);
    }
  }, []);

  const setThemePreference = useCallback(
    async (nextTheme: 'dark' | 'light') => {
      setTheme(nextTheme);
      if (user) {
        try {
          const res = await apiClient.patch<{
            success: boolean;
            data: { settings: UserSettings };
          }>('/users/me/settings', { theme: nextTheme });
          setUser((prev) => (prev ? { ...prev, settings: res.data.data.settings } : prev));
        } catch {
          toast.error('Unable to persist theme preference right now.');
        }
      }
    },
    [user]
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Clear local memory state regardless
    } finally {
      setUser(null);
      setSessionId(null);
      resetCsrfTokenCache();
      await ensureCsrfToken().catch(() => undefined);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        sessionId,
        loading,
        theme,
        setThemePreference,
        refreshUser,
        setAuthenticatedUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
