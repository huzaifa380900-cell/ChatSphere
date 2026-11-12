import { NotFoundPage } from '../views/ErrorPages.tsx';

/**
 * Catch-all 404 route.
 *
 * Serves the exact same UI the SPA used to render for unmatched paths.
 */
export default function NotFound() {
  return <NotFoundPage />;
}
