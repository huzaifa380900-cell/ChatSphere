import { GuestOnlyView } from '../../components/RouteGuards.tsx';
import { RegisterPage } from '../../views/AuthPages.tsx';

/**
 * /register — Account creation.
 */
export default function Page() {
  return (
    <GuestOnlyView>
      <RegisterPage />
    </GuestOnlyView>
  );
}
