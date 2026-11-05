import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { defaultName } from '@/src/lib/app/users';
import { nameFromEmail, personalWorkspaceName, workspaceNameFromEmail } from '@/src/lib/app/welcome';
import { AuthCard } from '@/src/components/app/AuthCard';
import { WelcomeForm } from './WelcomeForm';
import { welcomeWorkspace } from './welcomeWorkspace';

export const metadata: Metadata = {
    title: 'Welcome'
};

/**
 * The first-run step of a new account (`/app` sends it here once): its name and, when the account got a
 * workspace of its own, that workspace's name. Both start as the email (`maya.tester`,
 * `maya.tester@example.test`), so the fields suggest better ones: `Maya Tester`, and the email's domain
 * (`Example`) unless it is webmail (`Maya’s workspace`).
 */
export default async function WelcomePage() {
    const context = await requireAppContext();
    const { user } = context;
    if (!user.welcomePending)
        redirect(KnownPages.App);

    // A name from Google sign-in is already a real one
    const name = user.name !== defaultName(user.email) ? user.name : nameFromEmail(user.email);
    const workspace = welcomeWorkspace(context);
    const workspaceName = workspace && (workspace.name !== user.email
        ? workspace.name
        : workspaceNameFromEmail(user.email) ?? personalWorkspaceName(name));

    return (
        <AuthCard title="Welcome to uier" description="Check how others see you. You can change this later.">
            <WelcomeForm name={name} workspaceName={workspaceName} />
        </AuthCard>
    );
}
