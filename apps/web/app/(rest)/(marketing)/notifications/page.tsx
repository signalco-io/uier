import type { Metadata } from 'next';
import { Button } from '@signalco/ui-primitives/Button';
import { PageHeader } from '@/src/components/marketing/ContentPage';
import { inspectNotificationToken } from '@/src/lib/notifications/preferences';
import { NotificationForm } from './NotificationForm';

export const metadata: Metadata = { title: 'Email notifications', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage({ searchParams }: PageProps<'/notifications'>) {
    const { token } = await searchParams;
    const inspected = await inspectNotificationToken(token);
    return <div className="max-w-2xl pb-12">
        <PageHeader title="Email notifications" lead={inspected?.payload.mode === 'verify'
            ? 'Confirm your address to receive replies and status changes for this thread.'
            : 'Manage the emails sent to you about this review.'} />
        {inspected && typeof token === 'string'
            ? <NotificationForm token={token} mode={inspected.payload.mode} />
            : <div className="flex flex-col gap-4 rounded-xl border p-6">
                <p>This link has expired or is no longer active. You can manage notifications in the thread toolbar.</p>
                <Button href="/app/projects" variant="outlined">Open your projects</Button>
            </div>}
    </div>;
}
