'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { startTransition, useActionState, useId, useOptimistic } from 'react';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Switch } from '@/src/components/ui/switch';
import { FormMessage } from '@/src/components/app/FormMessage';
import { Section } from '@/src/components/app/PageHeader';
import { setWorkspaceAiTitlesAction } from './actions';

/** AI: thread titles for the workspace's projects. The switch saves at once. */
export function WorkspaceAiTitlesForm({ enabled }: { enabled: boolean }) {
    const { t } = useAppI18n();
    const id = useId();
    const [state, action, pending] = useActionState(setWorkspaceAiTitlesAction, null);
    const [optimistic, setOptimistic] = useOptimistic(enabled);

    const handleChange = (on: boolean) => startTransition(() => {
        setOptimistic(on);
        const formData = new FormData();
        formData.set(t("aiTitles"), String(on));
        action(formData);
    });

    return (
        <Section id="ai" title={t("AI")}>
            <FieldGroup>
                <Field orientation="horizontal">
                    <Switch id={id} checked={optimistic} onCheckedChange={handleChange} disabled={pending} aria-describedby={`${id}-description`} />
                    <FieldContent>
                        <FieldLabel htmlFor={id}>{t("Thread titles")}</FieldLabel>
                        <FieldDescription id={`${id}-description`}>{t("Claude Haiku, an AI model from Anthropic, writes a short title for each thread from its first message. Lists, Copy issue and coding tools show it in place of the first line. Each project can choose its own setting. On by default.")}</FieldDescription>
                    </FieldContent>
                </Field>
                <FormMessage state={state} />
            </FieldGroup>
        </Section>
    );
}
