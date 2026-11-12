import { RouteSearchParamsBoundary } from '../../components/RouteSearchParamsBoundary.tsx';
import { ResetPasswordPage } from '../../views/AuthPages.tsx';

export default function Page() {
  return (
    <RouteSearchParamsBoundary>
      <ResetPasswordPage />
    </RouteSearchParamsBoundary>
  );
}
