
import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { PUBLIC_WORKSPACE_ID } from '@/src/lib/comments/publicProjectPolicy';
import { Card } from '@/src/components/ui/card';
import { requireAdminContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { clientNames, loadClients } from '@/src/lib/app/clients';
import { NewProjectForm } from '@/src/components/app/projects/NewProjectForm';
import { NewProjectHeader } from '@/src/components/app/projects/NewProjectHeader';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("Create project") };
}

/** Onboarding, step 1: the site (then step 2, the install page) */
async function NewProjectFields() {
    const context = await requireAdminContext();
    if (context.workspace.id === PUBLIC_WORKSPACE_ID) redirect(KnownPages.AppProjects);
    const projects = await listVisibleProjects(context);
    const clients = clientNames(projects, await loadClients(context.workspace.id));
    return <Card><NewProjectForm clients={clients} /></Card>;
}

export default function NewProjectPage() {
    return <div className="mx-auto flex w-full max-w-xl flex-col">
        <NewProjectHeader />
        <Suspense fallback={<PageLoading title="Loading new" />}><NewProjectFields /></Suspense>
    </div>;
}
