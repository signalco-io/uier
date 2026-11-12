'use client';

import { useActionState, useId } from 'react';
import type { ThreadLabel } from '@/src/lib/app/threadLabel';
import { useAppI18n } from '@/src/lib/i18n/client';
import { Section } from '@/src/components/app/PageHeader';
import { SaveFooter, useSettingsDraft } from '@/src/components/app/SettingsSave';
import { ThreadLabelsEditor } from '@/src/components/app/ThreadLabelsEditor';
import { setWorkspaceThreadLabelsAction } from './actions';

export function WorkspaceThreadLabelsForm({ labels }: { labels: ThreadLabel[] }) {
    const { t } = useAppI18n();
    const id = useId();
    const [state, action, pending] = useActionState(setWorkspaceThreadLabelsAction, null);
    const { draft, update, dirty, discard } = useSettingsDraft(labels, state);
    return <Section id="labels" title={t('Labels')} description={t('Projects inherit workspace labels or use their own set.')} stickyFooter
        footer={<SaveFooter formId={id} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
        <form id={id} action={action} onResetCapture={event => { event.preventDefault(); event.stopPropagation(); }}>
            <input type="hidden" name="threadLabels" value={JSON.stringify(draft)} />
            <ThreadLabelsEditor value={draft} onChange={labels => update(() => labels)} disabled={pending} />
        </form>
    </Section>;
}
