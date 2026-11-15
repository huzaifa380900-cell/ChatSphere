'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type PageTheme = 'light' | 'dark';

const PageThemeContext = createContext<{
  theme: PageTheme;
  toggleTheme: () => void;
} | null>(null);

export function PageThemeScope({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<PageTheme>('light');

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('chatsphere-page-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    window.localStorage.setItem('chatsphere-page-theme', nextTheme);
    setTheme(nextTheme);
  };

  return (
    <PageThemeContext.Provider value={{ theme, toggleTheme }}>
      <div className="page-theme-scope" data-page-theme={theme}>
        {children}
      </div>
    </PageThemeContext.Provider>
  );
}

export function PageThemeSwitch() {
  const pageTheme = useContext(PageThemeContext);
  if (!pageTheme) {
    throw new Error('PageThemeSwitch must be rendered inside PageThemeScope.');
  }

  const { theme, toggleTheme } = pageTheme;
  const Icon = theme === 'light' ? Moon : Sun;

  return (
    <button
      type="button"
      className="page-theme-switch"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      <span>{theme === 'light' ? 'Dark' : 'Light'} mode</span>
    </button>
  );
}

export function usePageTheme() {
  const pageTheme = useContext(PageThemeContext);
  if (!pageTheme) {
    throw new Error('usePageTheme must be used inside PageThemeScope.');
  }
  return pageTheme;
}
