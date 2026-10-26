import type { Metadata } from 'next';
import { Card } from '@/src/components/ui/card';
import { requireAdminContext } from '@/src/lib/app/context';
import { listVisibleProjects } from '@/src/lib/app/projects';
import { clientNames } from '@/src/lib/app/clients';
import { PageHeader } from '@/src/components/app/PageHeader';
import { NewProjectForm } from '@/src/components/app/projects/NewProjectForm';
import { OnboardingSteps } from '@/src/components/app/projects/OnboardingSteps';

export const metadata: Metadata = {
    title: 'Create project'
};

/** Onboarding, step 1: the site (then step 2, the install page) */
export default async function NewProjectPage() {
    const context = await requireAdminContext();
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col">
            <PageHeader
                title="Create a project"
                description="Tell uier which site you want to review. Next, you add one script tag to it.">
                <OnboardingSteps current={1} className="mt-2" />
            </PageHeader>
            <Card>
                <NewProjectForm clients={clientNames(await listVisibleProjects(context))} />
            </Card>
        </div>
    );
}
