import { Suspense } from 'react';
import { connection } from 'next/server';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/src/components/ui/card';
import { projectLinkAccounts } from '@/src/lib/app/projectLinkAccounts';
import { safeNextPath } from '@/src/lib/app/signIn';
import { getAppI18n } from '@/src/lib/i18n/server';
import { switchProjectAccount } from './actions';

async function Content({ searchParams }: PageProps<'/app/switch-project-account'>) {
    await connection();
    const next = safeNextPath((await searchParams).next);
    const choices = await projectLinkAccounts(await cookies(), next);
    if (!next || !choices.length) notFound();
    const { t } = await getAppI18n();
    return <><CardHeader>
        <CardTitle><h1>{t('Switch account or workspace')}</h1></CardTitle>
        <CardDescription>{t('Choose a signed-in account and workspace to open this link.')}</CardDescription>
    </CardHeader><CardContent className="flex flex-col gap-4">
        {choices.map(choice => <form key={choice.userId} action={switchProjectAccount}>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="userId" value={choice.userId} />
            <input type="hidden" name="workspaceId" value={choice.workspaceId} />
            <Button type="submit" variant="outline" className="h-auto min-h-11 w-full flex-col items-start whitespace-normal break-all text-left">
                <span>{choice.email}</span><span className="text-muted-foreground">{choice.workspaceName}</span>
            </Button>
        </form>)}
        <Link href="/app/projects" className={buttonVariants({ variant: 'ghost' })}>{t('Cancel')}</Link>
    </CardContent></>;
}
export default function Page(props: PageProps<'/app/switch-project-account'>) {
    return <Suspense fallback={<PageLoading />}><Content {...props} /></Suspense>;
}
