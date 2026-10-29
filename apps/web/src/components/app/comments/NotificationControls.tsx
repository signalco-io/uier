'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { updateNotificationAction } from './notificationActions';

/**
 * Following a thread, a quiet action as in the toolbar's thread; project emails are muted in the
 * project's settings (`ProjectEmailsButton`)
 */
export function NotificationControls({ projectId, threadId, following = false }: {
    projectId: string; threadId: string; following?: boolean;
}) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string>();
    return <>
        <Button size="xs" variant="ghost" className="font-normal text-muted-foreground hover:text-foreground pointer-coarse:min-h-11" disabled={pending} onClick={() => startTransition(async () => {
            const result = await updateNotificationAction(projectId, threadId, !following);
            setError(result?.ok === false ? result.error : undefined);
        })}>
            {pending && <Spinner data-icon="inline-start" />}
            {following ? 'Unfollow thread' : 'Follow thread'}
        </Button>
        {error && <p role="alert" className="m-0 basis-full px-2 text-xs text-destructive">{error}</p>}
    </>;
}
