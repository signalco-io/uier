
import { getAppI18n } from '@/src/lib/i18n/server';
import { Suspense, cache } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { Card } from '@/src/components/ui/card';
import { requireAdminContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { clientNames, loadClients } from '@/src/lib/app/clients';
import { NewProjectClient, NewProjectClientLoading, NewProjectForm, NewProjectSubmit } from '@/src/components/app/projects/NewProjectForm';
import { NewProjectMode } from '@/src/components/app/projects/NewProjectMode';
import { NewProjectHeader } from '@/src/components/app/projects/NewProjectHeader';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Create project") };
}

/**
 * What the form waits for: that the person may create a project here (an admin, and not in uier's own workspace,
 * which takes none from the app), and the clients to suggest. Read once for the request, by both parts below.
 */
const loadNewProject = cache(async () => {
    const context = await requireAdminContext();
    if (context.workspace.id === PUBLIC_WORKSPACE_ID) redirect(KnownPages.AppProjects);
    const projects = await listVisibleProjects(context);
    return { clients: clientNames(projects, await loadClients(context.workspace.id)) };
});

/** The client field's control, suggesting the clients of the projects the person can see */
async function NewProjectClients() {
    const { clients } = await loadNewProject();
    return <NewProjectClient clients={clients} />;
}

/** The form's button, once the person is authorized and the form is whole */
async function NewProjectAuthorizedSubmit() {
    await loadNewProject();
    return <NewProjectSubmit />;
}

/**
 * Onboarding, step 1: the site (then step 2, the install page). The heading, the steps and the form itself need no
 * data and are the page's shell, so the addresses and the name can be typed at once and stay as typed. The two parts
 * that read the request stream into the form: until they do, the client field's control is an outline and Create
 * project is disabled, so nobody submits before the page has authorized them (the action authorizes again).
 */
export default function NewProjectPage() {
    return <div className="mx-auto flex w-full max-w-xl flex-col">
        <NewProjectMode>
        <NewProjectHeader />
        <Card>
            <NewProjectForm
                client={<Suspense fallback={<NewProjectClientLoading />}><NewProjectClients /></Suspense>}
                submit={<Suspense fallback={<NewProjectSubmit authorized={false} />}><NewProjectAuthorizedSubmit /></Suspense>} />
        </Card>
        </NewProjectMode>
    </div>;
}
