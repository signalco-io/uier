import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireAppContext } from '@/src/lib/app/context';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { WorkspaceEntering } from '@/src/components/app/workspace/WorkspaceLoading';
import { workspaceTabs } from '@/src/components/app/workspace/workspaceTabs';

/** `/app/workspace`: the area's first tab the person has (Users for admins, otherwise Clients) */
async function WorkspacePageContent() {
    const context = await requireAppContext();
    const [first] = workspaceTabs({ admin: context.isAdmin, feedback: context.workspace.id === PUBLIC_WORKSPACE_ID });
    return redirect(first!.href);
}

/** Until the redirect: the area's header over that first tab's loading state, as the tab itself will show them */
export default function WorkspacePage() {
    return <Suspense fallback={<WorkspaceEntering />}><WorkspacePageContent /></Suspense>;
}
