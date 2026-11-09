'use client';

import { useActionState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { joinWorkspaceAction } from './actions';

/** Joining takes a click: nobody is added to a workspace just by signing in */
export function JoinWorkspaceForm({ workspaceId, workspaceName, next, primary }: {
    workspaceId: string;
    workspaceName: string;
    next: string;
    /** The only offer: a full-width button under it */
    primary: boolean;
}) {
    const [state, formAction, pending] = useActionState(joinWorkspaceAction, null);
    return (
        <form action={formAction} className={primary ? 'flex flex-col gap-4' : 'flex flex-col items-end gap-2'}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="next" value={next} />
            <FormMessage state={state} />
            <Button
                type="submit"
                size={primary ? 'lg' : 'default'}
                variant={primary ? 'default' : 'outline'}
                className={primary ? 'w-full' : undefined}
                aria-label={`Join ${workspaceName}`}
                disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                {primary ? `Join ${workspaceName}` : 'Join'}
            </Button>
        </form>
    );
}
