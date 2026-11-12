import { ProtectedView } from '../../components/RouteGuards.tsx';
import { RouteSearchParamsBoundary } from '../../components/RouteSearchParamsBoundary.tsx';
import { ChatWorkspacePage } from '../../views/ChatWorkspacePage.tsx';

export default function Page() {
  return (
    <RouteSearchParamsBoundary>
      <ProtectedView>
        <ChatWorkspacePage forcedMode="ALL" />
      </ProtectedView>
    </RouteSearchParamsBoundary>
  );
}
