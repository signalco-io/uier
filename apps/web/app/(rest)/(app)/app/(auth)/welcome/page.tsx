import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { KnownPages } from '@/src/knownPages';
import { requireAppContext } from '@/src/lib/app/context';
import { defaultName } from '@/src/lib/app/users';
import { nameFromEmail } from '@/src/lib/app/welcome';
import { AuthCard } from '@/src/components/app/AuthCard';
import { WelcomeForm } from './WelcomeForm';
import { welcomeWorkspace } from './welcomeWorkspace';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return {
    title: t('Welcome')
};
}

/**
 * The first-run step of a new account (`/app` sends it here once): its name and, when the account got a
 * workspace of its own, that workspace's stored name (Personal for newly created workspaces).
 */
async function WelcomePageContent() {
    const { t } = await getAppI18n();
    const context = await requireAppContext();
    const { user } = context;
    if (!user.welcomePending)
        redirect(KnownPages.App);

    // A name from Google sign-in is already a real one
    const name = user.name !== defaultName(user.email) ? user.name : nameFromEmail(user.email);
    const workspace = welcomeWorkspace(context);
    const workspaceName = workspace?.name;

    return (
        <AuthCard title={t("Welcome to uier")} description={t("Check how others see you. You can change this later.")}>
            <WelcomeForm name={name} workspaceName={workspaceName} />
        </AuthCard>
    );
}

export default function WelcomePage() {
    return <Suspense fallback={<PageLoading title="Loading welcome" />}><WelcomePageContent /></Suspense>;
}
