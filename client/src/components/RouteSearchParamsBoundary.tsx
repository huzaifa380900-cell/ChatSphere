import { Suspense } from 'react';
import { RouteSearchParamsFromUrlProvider } from '../context/RouterContext.tsx';

export function RouteSearchParamsBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <RouteSearchParamsFromUrlProvider>
        {children}
      </RouteSearchParamsFromUrlProvider>
    </Suspense>
  );
}
