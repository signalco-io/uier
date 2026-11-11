import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireAppContext } from '@/src/lib/app/context';
import { workspaceTabs } from '@/src/components/app/workspace/workspaceTabs';

/** `/app/workspace`: the area's first tab the person has (Users for admins, otherwise Clients) */
async function WorkspacePageContent() {
    const [first] = workspaceTabs(await requireAppContext());
    return redirect(first!.href);
}

export default function WorkspacePage() {
    return <Suspense fallback={<PageLoading title="Loading workspace" />}><WorkspacePageContent /></Suspense>;
}
