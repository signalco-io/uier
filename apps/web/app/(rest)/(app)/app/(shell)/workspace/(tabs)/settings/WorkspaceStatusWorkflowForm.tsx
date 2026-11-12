'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useActionState, useId } from 'react';
import type { StatusWorkflow } from '@/src/lib/app/statusWorkflow';
import { Section } from '@/src/components/app/PageHeader';
import { SaveFooter, useSettingsDraft } from '@/src/components/app/SettingsSave';
import { StatusWorkflowEditor } from '@/src/components/app/StatusWorkflowEditor';
import { setWorkspaceStatusWorkflowAction } from './actions';

export function WorkspaceStatusWorkflowForm({ workflow }: { workflow: StatusWorkflow }) {
    const { t } = useAppI18n();
    const id = useId();
    const [state, action, pending] = useActionState(setWorkspaceStatusWorkflowAction, null);
    const { draft, update, dirty, discard } = useSettingsDraft(workflow, state);
    return <Section id="statuses" title={t("Statuses")} description={t("Define statuses within the five workflow categories. Projects inherit these defaults or use their own set.")} stickyFooter
        footer={<SaveFooter formId={id} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
        <form id={id} action={action} onResetCapture={event => { event.preventDefault(); event.stopPropagation(); }}>
            <input type="hidden" name="statusWorkflow" value={JSON.stringify(draft)} />
            <StatusWorkflowEditor value={draft} onChange={types => update(() => types)} disabled={pending} />
        </form>
    </Section>;
}
