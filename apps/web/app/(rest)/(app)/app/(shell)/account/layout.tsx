import { Suspense } from 'react';
import { AccountFrame } from '@/src/components/app/account/AccountFrame';
import { Bar } from '@/src/components/app/loading/outlines';
import { requireAppContext } from '@/src/lib/app/context';

async function AccountEmail() {
    const { user } = await requireAppContext();
    return <span className="font-mono text-[13px]">{user.email}</span>;
}

/**
 * The heading and the section links read nothing (`AccountFrame`: the language the shell resolved and the address),
 * so the layout has no boundary around them: they are there the moment Account opens and stay while a section
 * loads. Only the email waits, in its own line; private account data still authorizes per request.
 */
export default function AccountLayout({ children }: LayoutProps<'/app/account'>) {
    return (
        <AccountFrame email={
            <Suspense fallback={<Bar className="h-5 w-64 max-w-full" />}>
                <AccountEmail />
            </Suspense>
        }>
            {children}
        </AccountFrame>
    );
}
