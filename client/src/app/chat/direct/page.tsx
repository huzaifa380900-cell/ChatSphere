import { ProtectedView } from '../../../components/RouteGuards.tsx';
import { RouteSearchParamsBoundary } from '../../../components/RouteSearchParamsBoundary.tsx';
import { ChatWorkspacePage } from '../../../views/ChatWorkspacePage.tsx';

export default function Page() {
  return (
    <RouteSearchParamsBoundary>
      <ProtectedView redirectAdminTo="/admin">
        <ChatWorkspacePage forcedMode="DIRECT" />
      </ProtectedView>
    </RouteSearchParamsBoundary>
  );
}
