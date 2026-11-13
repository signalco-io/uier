import { Suspense } from 'react';
import { connection } from 'next/server';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { cn } from 'cn';
import { AuthCard } from '@/src/components/app/AuthCard';
import { PageLoading } from '@/src/components/app/PageLoading';
import { buttonVariants } from '@/src/components/ui/button';
import { KnownPages } from '@/src/knownPages';
import { projectLinkAccounts } from '@/src/lib/app/projectLinkAccounts';
import { getBrowserAccounts } from '@/src/lib/app/session';
import { safeNextPath } from '@/src/lib/app/signIn';
import { getAppI18n } from '@/src/lib/i18n/server';
import { AccountChoice } from './AccountChoice';
import { switchProjectAccount } from './actions';

async function Content({ searchParams }: PageProps<'/app/switch-project-account'>) {
    await connection();
    const next = safeNextPath((await searchParams).next);
    const [choices, accounts] = await Promise.all([projectLinkAccounts(await cookies(), next), getBrowserAccounts()]);
    if (!next || !choices.length) notFound();
    const { t } = await getAppI18n();
    return (
        <AuthCard
            title={t('Switch account or workspace')}
            // Every choice opens the link's project in that project's workspace, so it is named once
            description={<span className="break-words">{t('Choose an account to open this link in the {workspace} workspace.', { workspace: choices[0]!.workspaceName })}</span>}>
            <div className="flex flex-col gap-4">
                {/* The explicit role keeps the list a list for screen readers once its markers are off */}
                <ul role="list" aria-label={t('Accounts that can open this link')} className="m-0 flex list-none flex-col gap-2 p-0">
                    {choices.map(choice => {
                        const account = accounts.find(account => account.id === choice.userId);
                        return (
                            <li key={choice.userId}>
                                <form action={switchProjectAccount}>
                                    <input type="hidden" name="next" value={next} />
                                    <input type="hidden" name="userId" value={choice.userId} />
                                    <input type="hidden" name="workspaceId" value={choice.workspaceId} />
                                    <AccountChoice name={account?.name ?? choice.email} email={choice.email} avatarUrl={account?.avatarUrl} />
                                </form>
                            </li>
                        );
                    })}
                </ul>
                <Link href={KnownPages.AppProjects} className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'w-full')}>{t('Cancel')}</Link>
            </div>
        </AuthCard>
    );
}
export default function Page(props: PageProps<'/app/switch-project-account'>) {
    return <Suspense fallback={<PageLoading />}><Content {...props} /></Suspense>;
}
