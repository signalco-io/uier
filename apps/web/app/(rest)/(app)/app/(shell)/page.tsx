import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { HeaderOutline, Loading } from '@/src/components/app/loading/outlines';
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

/** It only redirects: meanwhile it keeps what the shell's frame drew, the place of the next page's title */
export default function AppHomePage() {
    return <Suspense fallback={<Loading label="Loading workspace"><HeaderOutline /></Loading>}><AppHomePageContent /></Suspense>;
}
