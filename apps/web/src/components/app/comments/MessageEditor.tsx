'use client';

import { useState } from 'react';
import type { MessageMention } from './MentionTextarea';
import { MessageComposer } from './MessageComposer';

/**
 * A message edited in place, in the open thread: its saved text (mentions kept where they are) in the shared
 * `MessageComposer` with Cancel and Save, as the toolbar edits a message. Enter saves, Shift+Enter adds a line,
 * Escape cancels. Without `mentionsIn` the text has no `@` mentions (the thread's first message).
 */
export function MessageEditor({ mentionsIn, label, text: initialText, mentions: initialMentions = [], error, pending, onCancel, onSave }: {
    mentionsIn?: { projectId: string; commentId: string };
    /** "Edit reply": the form's and the field's name */
    label: string;
    text: string;
    mentions?: MessageMention[];
    /** Why the last save failed; the text is kept */
    error?: string;
    /** The save is on its way; the editor stays open until it is done */
    pending?: boolean;
    onCancel: () => void;
    onSave: (text: string, mentions: MessageMention[]) => void;
}) {
    const [text, setText] = useState(initialText);
    const [mentions, setMentions] = useState(initialMentions);

    return <MessageComposer label={label} name="message" value={text} mentions={mentions} mentionsIn={mentionsIn}
        onValueChange={(value, next) => { setText(value); setMentions(next); }}
        submitLabel="Save" submitVerb="save" onSubmit={() => onSave(text, mentions)} pending={pending}
        onCancel={onCancel} escapeCancels error={error} />;
}
