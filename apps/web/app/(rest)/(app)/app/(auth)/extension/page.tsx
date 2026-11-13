import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ClockIcon, MousePointerClickIcon } from 'lucide-react';
import { requireAppContext } from '@/src/lib/app/context';
import { validateAuthorization, type Authorization } from '@/src/lib/extension/auth';
import { AuthCard } from '@/src/components/app/AuthCard';
import { ExtensionConsentForm } from '@/src/components/app/extension/ExtensionConsentForm';
import { AccountSessionBoundary } from '@/src/components/app/shell/AccountSessionBoundary';
import { cookies } from 'next/headers';
import { browserSessions } from '@/src/lib/app/browserAccounts';
import { originSchema, projectsForSite } from '@/src/lib/extension/review';
import { ExtensionAccounts } from '@/src/components/app/extension/ExtensionAccounts';

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t('Extension sign-in') };
}

/** The browser extension's sign-in (`identity.launchWebAuthFlow`): one card, like signing in to the app */
async function ExtensionConsentContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const { t } = await getAppI18n();
    const context = await requireAppContext();
    const params = await searchParams;
    let input: Authorization;
    try { input = validateAuthorization(params); }
    catch {
        return <AuthCard title={t("Extension sign-in is unavailable")} description={t("Use the registered uier extension and try again.")} />;
    }
    const site = originSchema.safeParse(params.siteOrigin);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (typeof value === 'string') query.set(key, value);
    if (site.success) query.set('siteOrigin', site.data);
    const accounts = await Promise.all((await browserSessions(await cookies())).map(async session => ({
        id: session.user.id, name: session.user.name, email: session.user.email, active: session.user.id === context.user.id,
        projects: site.success ? (await projectsForSite(session.user.id, site.data)).projects.map(project => ({
            id: project.projectId, name: project.name, workspaceName: project.workspaceName
        })) : undefined
    })));
    return (
        <AuthCard
            title={t("Sign in to the uier extension")}
            description={<>{t("Continue as")}{' '}<span className="font-medium text-foreground">{context.user.name}</span>{t(". The extension can review configured sites in projects you can access.")}</>}>
            <AccountSessionBoundary userId={context.user.id} reloadOnChange />
            <ExtensionAccounts accounts={accounts} next={`/app/extension?${query}`} siteOrigin={site.success ? site.data : undefined} />
            <ul className="m-0 mb-6 flex list-none flex-col gap-3 p-0 text-sm text-muted-foreground">
                <li className="flex gap-2.5">
                    <MousePointerClickIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" strokeWidth={1.75} />
                    <span>{t("Only sites where you choose Start review are activated.")}</span>
                </li>
                <li className="flex gap-2.5">
                    <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" strokeWidth={1.75} />
                    <span>{input.renewable === 'true'
                        ? t("Stay signed in across browser restarts. Sign-in ends after 30 days without use or after one year.")
                        : t("Sign-in ends after eight hours or when you restart your browser.")}</span>
                </li>
            </ul>
            <ExtensionConsentForm userId={context.user.id} authorization={input} />
        </AuthCard>
    );
}

export default function ExtensionConsent(props: Parameters<typeof ExtensionConsentContent>[0]) {
    return <Suspense fallback={<PageLoading title="Loading extension" />}><ExtensionConsentContent {...props} /></Suspense>;
}
