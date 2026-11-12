import { ProtectedView } from '../../components/RouteGuards.tsx';
import { ProfileSettingsPage } from '../../views/ProfileSettingsPage.tsx';

export default function Page() {
  return (
    <ProtectedView>
      <ProfileSettingsPage />
    </ProtectedView>
  );
}
