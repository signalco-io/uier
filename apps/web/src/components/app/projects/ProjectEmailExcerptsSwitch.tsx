'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { startTransition, useActionState, useId, useOptimistic } from 'react';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Switch } from '@/src/components/ui/switch';
import { FormMessage } from '../FormMessage';
import { updateProjectEmailExcerptsAction } from './actions';

/** Whether project emails carry comment excerpts, on or off at once; the server action requires an admin */
export function ProjectEmailExcerptsSwitch({ projectId, enabled }: { projectId: string; enabled: boolean }) {
    const { t } = useAppI18n();
    const id = useId();
    const [state, action, pending] = useActionState(updateProjectEmailExcerptsAction, null);
    const [optimistic, setOptimistic] = useOptimistic(enabled);

    const handleChange = (on: boolean) => startTransition(() => {
        setOptimistic(on);
        const formData = new FormData();
        formData.set("projectId", projectId);
        formData.set("emailCommentExcerpts", String(on));
        action(formData);
    });

    return (
        <FieldGroup>
            <Field orientation="horizontal">
                <Switch id={id} checked={optimistic} onCheckedChange={handleChange} disabled={pending} aria-describedby={`${id}-description`} />
                <FieldContent>
                    <FieldLabel htmlFor={id}>{t("Include comment excerpts")}</FieldLabel>
                    <FieldDescription id={`${id}-description`}>{t("Up to 160 characters of each comment, sent to every recipient, verified guests included. Off by default.")}</FieldDescription>
                </FieldContent>
            </Field>
            <FormMessage state={state} />
        </FieldGroup>
    );
}
