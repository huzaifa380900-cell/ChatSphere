import { RouteSearchParamsProvider } from '../../../../context/RouterContext.tsx';
import { GoogleCallbackPage } from '../../../../views/AuthPages.tsx';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <RouteSearchParamsProvider searchParams={params}>
      <GoogleCallbackPage />
    </RouteSearchParamsProvider>
  );
}
