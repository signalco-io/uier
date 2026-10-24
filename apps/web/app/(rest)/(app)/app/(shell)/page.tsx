import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';

/** `/app`: the projects, or onboarding for an admin without any */
export default async function AppHomePage() {
    const context = await requireAppContext();
    const projects = await listVisibleProjects(context);
    redirect(!projects.length && context.isAdmin ? KnownPages.AppNewProject : KnownPages.AppProjects);
}
