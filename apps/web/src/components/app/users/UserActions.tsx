'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@signalco/ui-primitives/Button';
import { ModalConfirm } from '@signalco/ui/ModalConfirm';
import { showNotification } from '@signalco/ui-notifications';
import type { ActionState } from '../../../lib/app/actionResult';
import { removeMemberAction, revokeInvitationAction } from './actions';

function useRun() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const run = (action: () => Promise<ActionState>, success: string) => startTransition(async () => {
        const result = await action();
        if (result && !result.ok) {
            showNotification(result.error, 'error');
            return;
        }
        showNotification(success, 'success');
        router.refresh();
    });
    return { pending, run };
}

/** Removes a member from the workspace, after a confirmation */
export function RemoveMemberButton({ userId, name }: { userId: string; name: string }) {
    const { pending, run } = useRun();
    const [confirming, setConfirming] = useState(false);
    return (
        <>
            <Button variant="plain" size="sm" disabled={pending} aria-label={`Delete ${name}`} onClick={() => setConfirming(true)}>
                Delete
            </Button>
            <ModalConfirm
                title={`Delete ${name}`}
                header={`Delete ${name}?`}
                open={confirming}
                onOpenChange={setConfirming}
                onConfirm={() => run(() => removeMemberAction(userId), `${name} was removed.`)}>
                They lose access to every project in this workspace. Their comments stay.
            </ModalConfirm>
        </>
    );
}

export function RevokeInvitationButton({ invitationId, email }: { invitationId: string; email: string }) {
    const { pending, run } = useRun();
    return (
        <Button
            variant="plain"
            size="sm"
            disabled={pending}
            aria-label={`Revoke the invitation for ${email}`}
            onClick={() => run(() => revokeInvitationAction(invitationId), 'Invitation revoked.')}>
            Revoke
        </Button>
    );
}
