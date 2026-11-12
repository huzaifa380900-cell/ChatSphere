import { ProtectedView } from '../../components/RouteGuards.tsx';
import { NotificationsPage } from '../../views/NotificationsPage.tsx';

export default function Page() {
  return (
    <ProtectedView>
      <NotificationsPage />
    </ProtectedView>
  );
}
