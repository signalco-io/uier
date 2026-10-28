'use client';

import { useState, useTransition } from 'react';
import { BellIcon, BellOffIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { updateNotificationAction } from './notificationActions';

/** Following a thread; project emails are muted in the project's settings (`ProjectEmailsButton`) */
export function NotificationControls({ projectId, threadId, following = false }: {
    projectId: string; threadId: string; following?: boolean;
}) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string>();
    return <div className="flex flex-col items-start gap-2">
        <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => startTransition(async () => {
            const result = await updateNotificationAction(projectId, threadId, !following);
            setError(result?.ok === false ? result.error : undefined);
        })}>
            {pending ? <Spinner data-icon="inline-start" /> : following
                ? <BellOffIcon aria-hidden="true" data-icon="inline-start" />
                : <BellIcon aria-hidden="true" data-icon="inline-start" />}
            {following ? 'Unfollow thread' : 'Follow thread'}
        </Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>;
}
