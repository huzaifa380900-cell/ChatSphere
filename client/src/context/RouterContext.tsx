'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import {
  usePathname,
  useRouter as useNextRouter,
  useSearchParams,
} from 'next/navigation';

/**
 * Router adapter for the Next.js App Router.
 *
 * The application was originally written against a hand-rolled router
 * (pushState + popstate) that shipped with the Vite SPA. Rather than rewriting
 * every call site, this module keeps the exact same public API and swaps the
 * implementation for Next.js primitives:
 *
 *   useRouter().pathname        -> usePathname()
 *   useRouter().navigate(url)   -> router.push() / router.replace()
 *   AppLink                     -> next/link
 *
 * Every existing consumer (LandingPage, AuthPages, ChatWorkspacePage,
 * DashboardShell, NotificationsPage, ProfileSettingsPage, AdminDashboardPage,
 * ErrorPages) therefore keeps working without modification.
 *
 * Query parameters are supplied through a separate context so that they can be
 * resolved on the SERVER (in a Server Component page) and handed down as
 * props. That keeps `?token=` / `?email=` / `?conversation=` correct in the
 * very first HTML response, instead of flashing an empty value and patching it
 * in after hydration.
 */

export interface NavigateOptions {
  replace?: boolean;
}

export interface AppRouterValue {
  pathname: string;
  navigate: (to: string, options?: NavigateOptions) => void;
}

export type QueryParams = Record<string, string | string[] | undefined>;

const RouterContext = createContext<AppRouterValue | null>(null);
const SearchParamsContext = createContext<URLSearchParams | null>(null);

export function useRouter(): AppRouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter must be used inside RouterProvider');
  }
  return ctx;
}

/**
 * Query-string access for routes wrapped in a search-params provider.
 */
export function useRouterSearchParams(): { searchParams: URLSearchParams } {
  const ctx = useContext(SearchParamsContext);
  if (!ctx) {
    throw new Error(
      'useRouterSearchParams must be used inside a RouteSearchParamsProvider (see app/*/page.tsx)',
    );
  }
  return { searchParams: ctx };
}

/**
 * Drop-in replacement for the original Vite-era <AppLink>.
 *
 * next/link renders a real <a> element, preserves modifier-click behaviour
 * (ctrl/cmd/shift/middle click still opens a new tab natively) and performs
 * client-side navigation for internal routes.
 */
export function AppLink({
  href,
  className,
  children,
  onClick,
  suppressHydrationWarning,
  title,
  'aria-label': ariaLabel,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  suppressHydrationWarning?: boolean;
  title?: string;
  'aria-label'?: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={onClick}
      suppressHydrationWarning={suppressHydrationWarning}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}

/**
 * App Router bridge — supplies `pathname` and `navigate` from next/navigation.
 * Mounted once in app/providers.tsx.
 */
export function NextRouterProvider({ children }: { children: React.ReactNode }) {
  const nextRouter = useNextRouter();
  const pathname = usePathname() ?? '/';

  const navigate = useCallback(
    (to: string, options?: NavigateOptions) => {
      if (options?.replace) {
        nextRouter.replace(to);
      } else {
        nextRouter.push(to);
      }
    },
    [nextRouter],
  );

  const value = useMemo(() => ({ pathname, navigate }), [pathname, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/**
 * Publishes the supplied query parameters to client components.
 */
export function RouteSearchParamsProvider({
  searchParams,
  children,
}: {
  searchParams: QueryParams;
  children: React.ReactNode;
}) {
  const value = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, raw] of Object.entries(searchParams ?? {})) {
      if (Array.isArray(raw)) {
        for (const item of raw) params.append(key, item);
      } else if (raw !== undefined) {
        params.set(key, raw);
      }
    }
    return params;
  }, [searchParams]);

  return <SearchParamsContext.Provider value={value}>{children}</SearchParamsContext.Provider>;
}

export function RouteSearchParamsFromUrlProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const urlSearchParams = useSearchParams();
  const searchParams = useMemo(() => {
    const params: QueryParams = {};
    urlSearchParams.forEach((value, key) => {
      const existing = params[key];
      params[key] =
        existing === undefined
          ? value
          : Array.isArray(existing)
            ? [...existing, value]
            : [existing, value];
    });
    return params;
  }, [urlSearchParams]);

  return (
    <RouteSearchParamsProvider searchParams={searchParams}>
      {children}
    </RouteSearchParamsProvider>
  );
}

/**
 * Legacy (Vite SPA) router — pushState + popstate.
 *
 * Retained so src/App.tsx, src/main.tsx, src/entry-client.tsx and
 * src/entry-server.tsx keep working. Under the App Router the route tree
 * provides navigation via <NextRouterProvider> instead.
 */
export function RouterProvider({
  children,
  initialUrl,
}: {
  children: React.ReactNode;
  initialUrl?: string;
}) {
  const [locationState, setLocationState] = useState(() => ({
    pathname: initialUrl
      ? new URL(initialUrl, 'http://localhost').pathname
      : typeof window !== 'undefined'
        ? window.location.pathname || '/'
        : '/',
    search: initialUrl
      ? new URL(initialUrl, 'http://localhost').search
      : typeof window !== 'undefined'
        ? window.location.search || ''
        : '',
  }));

  useEffect(() => {
    const onPopState = () => {
      setLocationState({
        pathname: window.location.pathname || '/',
        search: window.location.search || '',
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: NavigateOptions) => {
    const url = new URL(to, window.location.origin);
    if (options?.replace) {
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } else {
      window.history.pushState({}, '', url.pathname + url.search + url.hash);
    }
    setLocationState({
      pathname: url.pathname,
      search: url.search,
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const searchParams = useMemo(
    () => new URLSearchParams(locationState.search),
    [locationState.search],
  );

  const value = useMemo(
    () => ({
      pathname: locationState.pathname,
      navigate,
    }),
    [locationState.pathname, navigate],
  );

  return (
    <RouterContext.Provider value={value}>
      <SearchParamsContext.Provider value={searchParams}>{children}</SearchParamsContext.Provider>
    </RouterContext.Provider>
  );
}
