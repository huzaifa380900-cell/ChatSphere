import { ProtectedView } from '../../../components/RouteGuards.tsx';
import { RouteSearchParamsProvider } from '../../../context/RouterContext.tsx';
import { ChatWorkspacePage } from '../../../views/ChatWorkspacePage.tsx';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <RouteSearchParamsProvider searchParams={params}>
      <ProtectedView>
        <ChatWorkspacePage forcedMode="GROUP" />
      </ProtectedView>
    </RouteSearchParamsProvider>
  );
}
