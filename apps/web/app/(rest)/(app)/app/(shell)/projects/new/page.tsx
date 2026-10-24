import type { Metadata } from 'next';
import { requireAdminContext } from '@/src/lib/app/context';
import { PageHeader } from '@/src/components/app/PageHeader';
import { NewProjectForm } from '@/src/components/app/projects/NewProjectForm';

export const metadata: Metadata = {
    title: 'Create project'
};

/** Onboarding, step 1: the site (then step 2, the install page) */
export default async function NewProjectPage() {
    await requireAdminContext();
    return (
        <div className="max-w-xl">
            <PageHeader
                title="Create a project"
                description="Step 1 of 2. Tell uier which site you want to review. Next, you add one script tag to it." />
            <NewProjectForm />
        </div>
    );
}
