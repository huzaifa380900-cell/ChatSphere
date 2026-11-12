import { GuestOnlyView } from '../../components/RouteGuards.tsx';
import { LoginPage } from '../../views/AuthPages.tsx';

/**
 * /login — Sign in.
 *
 * GuestOnlyView reproduces the original "redirect to /chat when already
 * signed in" behaviour from App.tsx.
 */
export default function Page() {
  return (
    <GuestOnlyView>
      <LoginPage />
    </GuestOnlyView>
  );
}
