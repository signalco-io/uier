'use client';

import { useOptimistic, useState, useTransition, type ReactNode } from 'react';
import { Switch } from '@/src/components/ui/switch';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { IntegrationProviderId } from '@/src/lib/integrations/model';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';

/**
 * An optional sync of a connection, as a card with one switch that saves at once (like the other
 * settings switches). The switch shows the change itself; only a refusal adds a message.
 */
export function SyncOption({ id, title, description, label, projectId, provider, enabled, canEnable, action, children }: {
    id: string;
    title: string;
    description: string;
    /** The switch's accessible name */
    label: string;
    projectId: string;
    provider: IntegrationProviderId;
    enabled: boolean;
    /** Off is always possible; on needs a working connection */
    canEnable: boolean;
    action: (state: ActionState, form: FormData) => Promise<ActionState>;
    children: ReactNode;
}) {
    const [checked, setChecked] = useOptimistic(enabled);
    const [pending, start] = useTransition();
    const [state, setState] = useState<ActionState>(null);
    const change = (on: boolean) => start(async () => {
        setChecked(on);
        const form = new FormData();
        form.set('projectId', projectId); form.set('provider', provider); form.set('enabled', String(on));
        const result = await action(null, form);
        setState(result?.ok ? null : result);
    });
    return <Section id={id} title={title} description={description}
        actions={<Switch checked={checked} onCheckedChange={change} disabled={pending || (!enabled && !canEnable)} aria-label={label} />}>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            {children}
            <FormMessage state={state} />
        </div>
    </Section>;
}
