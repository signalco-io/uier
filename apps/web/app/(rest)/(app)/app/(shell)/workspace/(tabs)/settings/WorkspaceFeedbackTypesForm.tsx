'use client';

import { useActionState, useId } from 'react';
import type { FeedbackType } from '@uier/toolbar/feedback-types';
import { Section } from '@/src/components/app/PageHeader';
import { SaveFooter, useSettingsDraft } from '@/src/components/app/SettingsSave';
import { FeedbackTypesEditor } from '@/src/components/app/FeedbackTypesEditor';
import { setWorkspaceFeedbackTypesAction } from './actions';

export function WorkspaceFeedbackTypesForm({ types }: { types: FeedbackType[] }) {
    const id = useId();
    const [state, action, pending] = useActionState(setWorkspaceFeedbackTypesAction, null);
    const { draft, update, dirty, discard } = useSettingsDraft(types, state);
    return <Section id="feedback-types" title="Feedback types" description="The choices in Send feedback. Projects inherit these defaults or use their own list." stickyFooter
        footer={<SaveFooter formId={id} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
        <form id={id} action={action} onResetCapture={event => { event.preventDefault(); event.stopPropagation(); }}>
            <input type="hidden" name="feedbackTypes" value={JSON.stringify(draft)} />
            <FeedbackTypesEditor value={draft} onChange={types => update(() => types)} disabled={pending} />
        </form>
    </Section>;
}
