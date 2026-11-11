
import { getAppI18n } from '@/src/lib/i18n/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { Card } from '@/src/components/ui/card';
import { requireAdminContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { clientNames, loadClients } from '@/src/lib/app/clients';
import { PageHeader } from '@/src/components/app/PageHeader';
import { NewProjectForm } from '@/src/components/app/projects/NewProjectForm';
import { OnboardingSteps } from '@/src/components/app/projects/OnboardingSteps';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Create project") };
}

/** Onboarding, step 1: the site (then step 2, the install page) */
export default async function NewProjectPage() {
    const { t } = await getAppI18n();
    const context = await requireAdminContext();
    if (context.workspace.id === PUBLIC_WORKSPACE_ID) redirect(KnownPages.AppProjects);
    const projects = await listVisibleProjects(context);
    const clients = clientNames(projects, await loadClients(context.workspace.id));
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col">
            <PageHeader
                title={t("Create a project")}
                description={t("Tell uier which site you want to review. Then add the script and invite a reviewer.")}>
                <OnboardingSteps current={1} className="mt-2" />
            </PageHeader>
            <Card>
                <NewProjectForm clients={clients} />
            </Card>
        </div>
    );
}
