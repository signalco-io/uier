'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useId, useOptimistic, useTransition } from 'react';
import { toast } from 'sonner';
import { Field, FieldLabel } from '@/src/components/ui/field';
import { Switch } from '@/src/components/ui/switch';
import { setProjectEmailsMutedAction } from './actions';

/**
 * A person's own emails from a project, on or off at once (off mutes the project: no emails, also
 * not for threads they follow). Labelled by `label`, or named `ariaLabel` beside other text.
 */
export function ProjectEmailsSwitch({ projectId, muted, label, ariaLabel }: { projectId: string; muted: boolean; label?: string; ariaLabel?: string }) {
    const { t } = useAppI18n();
    const id = useId();
    const [optimisticMuted, setOptimisticMuted] = useOptimistic(muted);
    const [pending, startTransition] = useTransition();

    // The action revalidates the app; until then the switch shows the new setting
    const handleChange = (on: boolean) => startTransition(async () => {
        setOptimisticMuted(!on);
        const result = await setProjectEmailsMutedAction(projectId, !on);
        if (result && !result.ok)
            toast.error(t(result.error));
    });

    const control = <Switch id={id} checked={!optimisticMuted} onCheckedChange={handleChange} disabled={pending} aria-label={ariaLabel} />;
    return label
        ? (
            <Field orientation="horizontal" className="w-auto">
                {control}
                <FieldLabel htmlFor={id}>{label}</FieldLabel>
            </Field>
        )
        : control;
}
