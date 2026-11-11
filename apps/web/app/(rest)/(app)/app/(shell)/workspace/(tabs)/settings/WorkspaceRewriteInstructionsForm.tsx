'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { useActionState, useId } from 'react';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Textarea } from '@/src/components/ui/textarea';
import { Section } from '@/src/components/app/PageHeader';
import { SaveFooter, useSettingsDraft } from '@/src/components/app/SettingsSave';
import { MAX_REWRITE_INSTRUCTIONS_LENGTH } from '@/src/lib/rewrite/settings';
import { setWorkspaceRewriteInstructionsAction } from './actions';

export function WorkspaceRewriteInstructionsForm({ instructions }: { instructions: string }) {
    const { t } = useAppI18n();
    const id = useId();
    const [state, action, pending] = useActionState(setWorkspaceRewriteInstructionsAction, null);
    const { draft, dirty, update, discard } = useSettingsDraft({ instructions }, state);
    return (
        <Section id="rewrite-suggestions" title={t("Rewrite suggestions")}
            description={t("Default tone, preferred terms and writing style for this workspace's AI copy suggestions. Projects can add to or replace them.")}
            footer={<SaveFooter formId={id} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <form id={id} action={action} onResetCapture={event => { event.preventDefault(); event.stopPropagation(); }}>
                <Field>
                    <FieldLabel htmlFor={`${id}-instructions`}>{t("Workspace rewrite instructions")}</FieldLabel>
                    <Textarea id={`${id}-instructions`} name="rewriteInstructions" value={draft.instructions}
                        onChange={event => update(() => ({ instructions: event.target.value }))} rows={5}
                        maxLength={MAX_REWRITE_INSTRUCTIONS_LENGTH} disabled={pending} aria-describedby={`${id}-description`}
                        placeholder={t("Use short sentences. Call people members, not users.")} />
                    <FieldDescription id={`${id}-description`}>{t("Up to")}{' '}{MAX_REWRITE_INSTRUCTIONS_LENGTH.toLocaleString('en')}{' '}{t("characters. Only admins can see or change these settings. Sent to Anthropic with each rewrite request. Leave empty for no additional style guidance.")}</FieldDescription>
                </Field>
            </form>
        </Section>
    );
}
