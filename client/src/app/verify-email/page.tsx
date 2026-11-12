import { RouteSearchParamsBoundary } from '../../components/RouteSearchParamsBoundary.tsx';
import { VerifyEmailPage } from '../../views/AuthPages.tsx';

export default function Page() {
  return (
    <RouteSearchParamsBoundary>
      <VerifyEmailPage />
    </RouteSearchParamsBoundary>
  );
}
