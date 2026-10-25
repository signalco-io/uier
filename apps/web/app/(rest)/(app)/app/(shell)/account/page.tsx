import type { Metadata } from 'next';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { requireAppContext } from '@/src/lib/app/context';
import { SignOutButton } from '@/src/components/app/shell/SignOutButton';
import { AccountForm, AppearanceSection } from './AccountForm';

export const metadata: Metadata = {
    title: 'Account'
};

export default async function AccountPage() {
    const { user } = await requireAppContext();
    return (
        <div className="flex max-w-3xl flex-col">
            <PageHeader title="Account" description={<span className="font-mono text-[13px]">{user.email}</span>} />
            <div className="flex flex-col gap-6">
                <AccountForm name={user.name} />
                <AppearanceSection />
                <Section id="session" title="Sign out" description="Sign out of uier on this browser." actions={<SignOutButton />} />
            </div>
        </div>
    );
}
