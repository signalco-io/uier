'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { MAX_NAME_LENGTH, MAX_WORKSPACE_NAME_LENGTH } from '@/src/lib/app/limits';
import { completeWelcomeAction, skipWelcomeAction } from './actions';

/**
 * The first-run step's fields, filled with suggestions: the name, and the name of the workspace made for
 * this account (`workspaceName`, none for someone who joined by invitation). Skip keeps both as they are.
 */
export function WelcomeForm({ name: suggestedName, workspaceName: suggestedWorkspaceName }: { name: string; workspaceName?: string }) {
    const { t, language } = useAppI18n();
    const id = useId();
    const [state, formAction, pending] = useActionState(completeWelcomeAction, null);
    const [skipState, skipAction, skipping] = useActionState(skipWelcomeAction, null);
    // Controlled, so a failed attempt keeps what was typed (React resets forms after an action)
    const [name, setName] = useState(suggestedName);
    const [workspaceName, setWorkspaceName] = useState(suggestedWorkspaceName ?? '');
    const busy = pending || skipping;

    return (
        <div className="flex flex-col gap-3">
            <form action={formAction}>
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor={`${id}-name`}>{t("Your name")}</FieldLabel>
                        <Input id={`${id}-name`} name="name" value={name} onChange={event => setName(event.target.value)}
                            autoComplete="name" maxLength={MAX_NAME_LENGTH} required autoFocus aria-describedby={`${id}-name-hint`} />
                        <FieldDescription id={`${id}-name-hint`}>{t("Shown on your comments and replies.")}</FieldDescription>
                    </Field>
                    {suggestedWorkspaceName !== undefined && (
                        <Field>
                            <FieldLabel htmlFor={`${id}-workspace`}>{t("Workspace name")}</FieldLabel>
                            <Input id={`${id}-workspace`} name="workspace" value={workspaceName} onChange={event => setWorkspaceName(event.target.value)}
                                autoComplete="organization" maxLength={MAX_WORKSPACE_NAME_LENGTH} required aria-describedby={`${id}-workspace-hint`} />
                            <FieldDescription id={`${id}-workspace-hint`}>{t("Shown to the people you invite.")}</FieldDescription>
                        </Field>
                    )}
                    <FormMessage state={state ?? skipState} />
                    <Button type="submit" size="lg" className="w-full" disabled={busy}>
                        {pending && <Spinner data-icon="inline-start" />}
                        {t("Continue")}{' '}</Button>
                </FieldGroup>
            </form>
            <form action={skipAction}>
                <Button type="submit" variant="ghost" size="lg" className="w-full" disabled={busy}>
                    {skipping && <Spinner data-icon="inline-start" />}
                    {t("Skip")}{' '}</Button>
            </form>
        </div>
    );
}
