import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import { AccountFrame } from '@/src/components/app/account/AccountFrame';
import { Skeleton } from '@/src/components/ui/skeleton';
import { requireAppContext } from '@/src/lib/app/context';

async function AccountEmail() {
    const { user } = await requireAppContext();
    return <span className="font-mono text-[13px]">{user.email}</span>;
}

/** The sections stay available on client navigation; private account data still authorizes per request. */
export default function AccountLayout({ children }: LayoutProps<'/app/account'>) {
    return <Suspense fallback={<PageLoading title="Loading account" />}>
        <AccountFrame email={
            <Suspense fallback={<Skeleton className="h-5 w-64 max-w-full animate-none" />}>
                <AccountEmail />
            </Suspense>
        }>
            {children}
        </AccountFrame>
    </Suspense>;
}
