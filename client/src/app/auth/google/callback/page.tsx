import { RouteSearchParamsBoundary } from '../../../../components/RouteSearchParamsBoundary.tsx';
import { GoogleCallbackPage } from '../../../../views/AuthPages.tsx';

export default function Page() {
  return (
    <RouteSearchParamsBoundary>
      <GoogleCallbackPage />
    </RouteSearchParamsBoundary>
  );
}
