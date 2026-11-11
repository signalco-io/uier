import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { PageHeader } from '@/src/components/marketing/ContentPage';
import { inspectNotificationToken } from '@/src/lib/notifications/preferences';
import { NotificationForm } from './NotificationForm';

export const metadata: Metadata = { title: 'Email notifications', robots: { index: false, follow: false } };

export default function NotificationsPage({ searchParams }: PageProps<'/notifications'>) {
    return <div className="flex max-w-2xl flex-col gap-10 pb-12">
        <PageHeader title="Email notifications" lead="Manage the emails sent to you about this review." />
        <Suspense fallback={<p className="min-h-32 text-muted-foreground" role="status">Loading notification preferences…</p>}>
            <NotificationPreferences searchParams={searchParams} />
        </Suspense>
    </div>;
}

async function NotificationPreferences({ searchParams }: Pick<PageProps<'/notifications'>, 'searchParams'>) {
    const { token } = await searchParams;
    const inspected = await inspectNotificationToken(token);
    return <>
        {inspected?.payload.mode === 'verify' && <p>Confirm your address to receive replies and status changes for this thread.</p>}
        {inspected && typeof token === 'string'
            ? <NotificationForm token={token} mode={inspected.payload.mode} />
            : <div className="flex flex-col gap-4 rounded-2xl border p-6">
                <p>This link has expired or is no longer active. You can manage notifications in the thread toolbar.</p>
                <Button href="/app/projects" variant="outlined">Open your projects</Button>
            </div>}
    </>;
}
