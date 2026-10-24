import type { Metadata } from 'next';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { requireAppContext } from '@/src/lib/app/context';
import { AccountForm } from './AccountForm';
import { SignOutButton } from '@/src/components/app/shell/SignOutButton';

export const metadata: Metadata = {
    title: 'Account'
};

export default async function AccountPage() {
    const { user } = await requireAppContext();
    return (
        <>
            <PageHeader title="Account" description={<span className="font-mono">{user.email}</span>} />
            <div className="flex max-w-2xl flex-col gap-6">
                <Section id="profile" title="Profile">
                    <AccountForm name={user.name} />
                </Section>
                <Section id="session" title="Sign out" description="Sign out of uier on this browser.">
                    <SignOutButton />
                </Section>
            </div>
        </>
    );
}
