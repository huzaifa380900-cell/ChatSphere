import { ProtectedView } from '../../components/RouteGuards.tsx';
import { AdminDashboardPage } from '../../views/AdminDashboardPage.tsx';

export default function Page() {
  return (
    <ProtectedView>
      <AdminDashboardPage />
    </ProtectedView>
  );
}
