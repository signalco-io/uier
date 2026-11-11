'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useState } from 'react';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { setReplySyncAction } from './actions';

export function ReplySync({ projectId, provider, enabled, canEnable, needsPermissions }: {
    projectId: string; provider: IntegrationProviderId; enabled: boolean; canEnable: boolean; needsPermissions: boolean;
}) {
    const { t } = useAppI18n();
    const id = useId(); const [checked, setChecked] = useState(enabled);
    const [state, save, pending] = useActionState(setReplySyncAction, null);
    return <Section id="reply-sync" title={t("Reply sync")} description={t("Keep the conversation together in uier and your connected tool.")}>
        <form action={save}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="provider" value={provider} />
            <input type="hidden" name="enabled" value={String(checked)} />
            <FieldGroup>
                <Field orientation="horizontal"><Checkbox id={id} checked={checked} onCheckedChange={value => setChecked(value === true)}
                    disabled={pending || (!enabled && (!canEnable || needsPermissions))} /><FieldLabel htmlFor={id}>{t("Sync replies in both directions")}</FieldLabel></Field>
                <FieldDescription>{t("New replies are copied as comments. Edit or delete the original reply to update its copies. Imported replies show their source and are read-only in uier.")}</FieldDescription>
                <FieldDescription>{t("Starts with replies added after enabling. Changes sync in the background. Existing feedback text and status settings are kept separate.")}</FieldDescription>
                {provider === 'notion' && <FieldDescription>{t("The Notion connection needs read and insert comment capabilities. Replies on the linked page are included; comments attached to individual content blocks are not.")}</FieldDescription>}
                {needsPermissions && <FieldDescription>{t("Reconnect Slack to allow reading replies in this connection’s public and private channels.")}</FieldDescription>}
                {provider === 'slack' && needsPermissions && <a className={buttonVariants({ variant: 'outline' })} href={`/app/slack/connect?project=${encodeURIComponent(projectId)}&replies=1`}>{t("Allow Slack reply access")}</a>}
                <Field><Button type="submit" className="w-fit" disabled={pending || checked === enabled || (checked && (!canEnable || needsPermissions))}>{t("Save reply sync")}</Button><FormMessage state={state} /></Field>
            </FieldGroup>
        </form>
    </Section>;
}
