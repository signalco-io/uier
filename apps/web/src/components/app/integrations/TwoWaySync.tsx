'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Checkbox } from '@/src/components/ui/checkbox';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { setTwoWaySyncAction } from './actions';

export function TwoWaySync({ projectId, provider, enabled, canEnable, needsMapping }: {
    projectId: string; provider: IntegrationProviderId; enabled: boolean; canEnable: boolean; needsMapping: boolean;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const [checked, setChecked] = useState(enabled);
    const [state, save, pending] = useActionState(setTwoWaySyncAction, null);
    return <Section id="two-way-sync" title={t("Two-way status sync")} description={t("Keep Open and Done in sync in both directions.")}>
        <form action={save}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="provider" value={provider} />
            <input type="hidden" name="enabled" value={String(checked)} />
            <FieldGroup>
                <Field orientation="horizontal">
                    <Checkbox id={id} checked={checked} onCheckedChange={value => setChecked(value === true)} disabled={pending || (!enabled && !canEnable)} />
                    <FieldLabel htmlFor={id}>{t("Enable two-way status sync")}</FieldLabel>
                </Field>
                <FieldDescription>{t("When on, closing or reopening the linked item also updates the feedback in uier. Changes are checked in the background, usually every five minutes. Pending uier changes take precedence.")}</FieldDescription>
                <FieldDescription>{t("When off, status changes in the connected tool stay there. Updates from uier continue while the integration is on.")}</FieldDescription>
                {needsMapping && <FieldDescription>{t("Load the Notion fields above and map a Status or Select field to Open and Done before enabling this option.")}</FieldDescription>}
                <Field><Button type="submit" className="w-fit" disabled={pending || checked === enabled || (checked && !canEnable)}>{t("Save two-way status sync")}</Button><FormMessage state={state} /></Field>
            </FieldGroup>
        </form>
    </Section>;
}
