'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState } from 'react';
import { LogInIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { signInAgainWithEmailAction } from '@/src/components/app/shell/actions';
import { KnownPages } from '@/src/knownPages';
import { DOMAIN_JOIN_SIGN_IN_AGAIN } from '@/src/lib/app/emailProof';
import { joinWorkspaceAction } from './actions';

/**
 * Joining takes a click: nobody is added to a workspace just by signing in. When the sign-in's email proof
 * has run out meanwhile (`emailProof.ts`), the button becomes Sign in again, back to this page afterwards.
 */
export function JoinWorkspaceForm({ workspaceId, workspaceName, next, primary }: {
    workspaceId: string;
    workspaceName: string;
    next: string;
    /** The only offer: a full-width button under it */
    primary: boolean;
}) {
    const { t, language } = useAppI18n();
    const [state, formAction, pending] = useActionState(joinWorkspaceAction, null);
    if (state?.ok === false && state.error === DOMAIN_JOIN_SIGN_IN_AGAIN)
        return (
            <form action={signInAgainWithEmailAction} className={primary ? "flex flex-col gap-4" : "flex flex-col items-end gap-2"}>
                <input type="hidden" name="next" value={`${KnownPages.AppJoin}?${new URLSearchParams({ next })}`} />
                <FormMessage state={state} />
                <Button type="submit" size={primary ? "lg" : "default"} variant="outline" className={primary ? "w-full" : undefined}>
                    <LogInIcon data-icon="inline-start" />
                    {t("Sign in again")}{' '}</Button>
            </form>
        );
    return (
        <form action={formAction} className={primary ? "flex flex-col gap-4" : "flex flex-col items-end gap-2"}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="next" value={next} />
            <FormMessage state={state} />
            <Button
                type="submit"
                size={primary ? "lg" : "default"}
                variant={primary ? "default" : "outline"}
                className={primary ? "w-full" : undefined}
                aria-label={t("Join {workspaceName}", { workspaceName: workspaceName })}
                disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                {primary ? t("Join {workspaceName}", { workspaceName: workspaceName }) : t("Join")}
            </Button>
        </form>
    );
}
