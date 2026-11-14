'use client';
import { useActionState } from 'react';
import { useAppI18n } from '../../../../lib/i18n/client';
import { Button } from '../../../ui/button';
import { Section } from '../../PageHeader';
import { FormMessage } from '../../FormMessage';
import { manualProjectAction } from './actions';

export function ManagedProject({ projectId }: { projectId: string }) {
    const { t } = useAppI18n(); const [state, action, pending] = useActionState(manualProjectAction, null);
    return <Section id="project-management" title={t('Automatically managed')} description={t('Notion controls this project’s name, addresses and status. Switch to manual to keep your own changes.')}>
        <form action={action} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="projectId" value={projectId} />
            <Button type="submit" variant="outline" disabled={pending}>{t('Use manual management')}</Button><FormMessage state={state} />
        </form>
    </Section>;
}
