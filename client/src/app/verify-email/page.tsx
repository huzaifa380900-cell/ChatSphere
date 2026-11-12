import { RouteSearchParamsProvider } from '../../context/RouterContext.tsx';
import { VerifyEmailPage } from '../../views/AuthPages.tsx';

/**
 * /verify-email — OTP verification.
 *
 * `?email=` is resolved on the server and handed to the client component, so
 * the pre-filled address is present in the first HTML response.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  return (
    <RouteSearchParamsProvider searchParams={sp}>
      <VerifyEmailPage />
    </RouteSearchParamsProvider>
  );
}
