import { RouteSearchParamsProvider } from '../../context/RouterContext.tsx';
import { ResetPasswordPage } from '../../views/AuthPages.tsx';

/**
 * /reset-password — Set a new password using `?token=`.
 *
 * The reset token is read on the server and passed down, so the form renders
 * with the token already in scope on the very first paint.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  return (
    <RouteSearchParamsProvider searchParams={sp}>
      <ResetPasswordPage />
    </RouteSearchParamsProvider>
  );
}
