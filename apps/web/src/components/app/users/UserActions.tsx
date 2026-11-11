'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/src/components/ui/alert-dialog';
import { Button } from '@/src/components/ui/button';
import type { ActionState } from '../../../lib/app/actionResult';
import { removeMemberAction, resendInvitationAction, revokeInvitationAction } from './actions';

function useRun() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const run = (action: () => Promise<ActionState>, success: string) => startTransition(async () => {
        const result = await action();
        if (result && !result.ok) {
            toast.error(result.error);
            return;
        }
        toast.success(success);
        router.refresh();
    });
    return { pending, run };
}

/** Removes a member from the workspace, after a confirmation */
export function RemoveMemberButton({ userId, name }: { userId: string; name: string }) {
    const { t } = useAppI18n();
    const { pending, run } = useRun();
    const [confirming, setConfirming] = useState(false);
    return (
        <>
            <Button variant="ghost" size="sm" disabled={pending} aria-label={t("Remove {value0}", { value0: name })} onClick={() => setConfirming(true)}>{t("Remove")}</Button>
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("Remove")}{' '}{name}?</AlertDialogTitle>
                        <AlertDialogDescription>{t("They lose access to every project in this workspace. Their comments stay. Guest links remain allowed where enabled; member removal does not revoke a public review link.")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => { setConfirming(false); run(() => removeMemberAction(userId), `${name} was removed.`); }}>{t("Remove")}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

export function RevokeInvitationButton({ invitationId, email }: { invitationId: string; email: string }) {
    const { t } = useAppI18n();
    const { pending, run } = useRun();
    return (
        <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={t("Revoke the invitation for {value0}", { value0: email })}
            onClick={() => run(() => revokeInvitationAction(invitationId), 'Invitation revoked.')}>{t("Revoke")}</Button>
    );
}

export function ResendInvitationButton({ invitationId, email }: { invitationId: string; email: string }) {
    const { t } = useAppI18n();
    const [pending, startTransition] = useTransition(), [link, setLink] = useState<string>();
    const router = useRouter();
    return <div className="flex flex-col gap-1"><Button variant="ghost" size="sm" disabled={pending} aria-label={t("Resend the invitation for {value0}", { value0: email })} onClick={() => startTransition(async () => {
        const result = await resendInvitationAction(invitationId);
        if (result?.ok) { setLink(result.data.devLink); toast.success('Invitation resent.'); router.refresh(); }
        else if (result) toast.error(result.error);
    })}>{t("Resend")}</Button>{link && <Link href={link} className="text-xs">{t("Open invitation")}</Link>}</div>;
}
