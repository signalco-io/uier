'use client';

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
    const id = useId(); const [checked, setChecked] = useState(enabled);
    const [state, save, pending] = useActionState(setReplySyncAction, null);
    return <Section id="reply-sync" title="Reply sync" description="Keep the conversation together in uier and your connected tool.">
        <form action={save}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="provider" value={provider} />
            <input type="hidden" name="enabled" value={String(checked)} />
            <FieldGroup>
                <Field orientation="horizontal"><Checkbox id={id} checked={checked} onCheckedChange={value => setChecked(value === true)}
                    disabled={pending || (!enabled && (!canEnable || needsPermissions))} /><FieldLabel htmlFor={id}>Sync replies in both directions</FieldLabel></Field>
                <FieldDescription>New replies are copied as comments. Edit or delete the original reply to update its copies. Imported replies show their source and are read-only in uier.</FieldDescription>
                <FieldDescription>Starts with replies added after enabling. Changes sync in the background. Existing feedback text and status settings are kept separate.</FieldDescription>
                {provider === 'notion' && <FieldDescription>The Notion connection needs read and insert comment capabilities. Replies on the linked page are included; comments attached to individual content blocks are not.</FieldDescription>}
                {needsPermissions && <FieldDescription>Reconnect Slack to allow reading replies in this connection’s public and private channels.</FieldDescription>}
                {provider === 'slack' && needsPermissions && <a className={buttonVariants({ variant: 'outline' })} href={`/app/slack/connect?project=${encodeURIComponent(projectId)}&replies=1`}>Allow Slack reply access</a>}
                <Field><Button type="submit" className="w-fit" disabled={pending || checked === enabled || (checked && (!canEnable || needsPermissions))}>Save reply sync</Button><FormMessage state={state} /></Field>
            </FieldGroup>
        </form>
    </Section>;
}
