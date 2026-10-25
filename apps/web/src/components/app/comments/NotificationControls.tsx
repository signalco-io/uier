'use client';

import { useState, useTransition } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { updateNotificationAction } from './notificationActions';

export function NotificationControls({ projectId, threadId, following = false, muted = false }: {
    projectId: string; threadId?: string; following?: boolean; muted?: boolean;
}) {
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string>();
    return <div className="flex flex-col items-start gap-2">
        <Button size="sm" variant="plain" disabled={pending} onClick={() => startTransition(async () => {
            const result = await updateNotificationAction(projectId, threadId, threadId ? !following : !muted);
            setError(result?.ok === false ? result.error : undefined);
        })}>{threadId ? following ? 'Unfollow thread' : 'Follow thread' : muted ? 'Unmute project emails' : 'Mute project emails'}</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>;
}
