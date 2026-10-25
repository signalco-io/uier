import type { Metadata } from 'next';
import { Card, CardDescription, CardHeader, CardTitle } from '@/src/components/ui/card';
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
        <div className="mx-auto flex w-full max-w-xl flex-col">
            <PageHeader
                title="Create a project"
                description="Tell uier which site you want to review. Next, you add one script tag to it." />
            <Card>
                <CardHeader>
                    <CardDescription className="text-xs font-medium tabular-nums">Step 1 of 2</CardDescription>
                    <CardTitle>
                        <h2 className="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">Your site</h2>
                    </CardTitle>
                </CardHeader>
                <NewProjectForm />
            </Card>
        </div>
    );
}
