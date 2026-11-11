import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';

/** `/app`: the first-run step of a new account, then the projects, or onboarding for an admin without any */
async function AppHomePageContent() {
    const context = await requireAppContext();
    if (context.user.welcomePending)
        redirect(KnownPages.AppWelcome);
    const projects = await listVisibleProjects(context);
    return redirect(!projects.length && context.isAdmin ? KnownPages.AppNewProject : KnownPages.AppProjects);
}

export default function AppHomePage() {
    return <Suspense fallback={<PageLoading title="Loading workspace" />}><AppHomePageContent /></Suspense>;
}
