'use client';

import { useState, useTransition } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { updateNotificationAction } from './notificationActions';

/** Following a thread; project emails are muted in the project's settings (`ProjectEmailsButton`) */
export function NotificationControls({ projectId, threadId, following = false }: {
    projectId: string; threadId: string; following?: boolean;
}) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string>();
    return <div className="flex flex-col items-start gap-2">
        <Button size="sm" variant="plain" disabled={pending} onClick={() => startTransition(async () => {
            const result = await updateNotificationAction(projectId, threadId, !following);
            setError(result?.ok === false ? result.error : undefined);
        })}>{following ? 'Unfollow thread' : 'Follow thread'}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>;
}
