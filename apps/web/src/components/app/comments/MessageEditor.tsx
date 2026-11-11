'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useState, useSyncExternalStore } from 'react';
import type { appCommentDrafts } from './replyDrafts';
import { FieldDescription } from '@/src/components/ui/field';
import type { MessageMention } from './MentionTextarea';
import { MessageComposer } from './MessageComposer';

const emptyMentions: MessageMention[] = [];

/**
 * A message edited in place, in the open thread: its saved text (mentions kept where they are) in the shared
 * `MessageComposer` with Cancel and Save, as the toolbar edits a message. Enter saves, Shift+Enter adds a line,
 * Escape cancels. Without `mentionsIn` the text has no `@` mentions (the thread's first message).
 */
export function MessageEditor({ drafts, draftKey, mentionsIn, label, text: initialText, mentions: initialMentions = emptyMentions, error, pending, onCancel, onSave }: {
    drafts: ReturnType<typeof appCommentDrafts>;
    draftKey: string;
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
    const { t } = useAppI18n();
    const text = useSyncExternalStore(listener => drafts.subscribe(draftKey, listener), () => drafts.get(draftKey) ?? initialText, () => initialText);
    const mentions = useSyncExternalStore(listener => drafts.subscribe(draftKey, listener), () => drafts.details(draftKey)?.mentions ?? initialMentions, () => initialMentions);
    const sharedPending = useSyncExternalStore(listener => drafts.subscribe(draftKey, listener), () => drafts.pending(draftKey), () => false);
    const [storageAvailable, setStorageAvailable] = useState(drafts.available);

    return <MessageComposer label={label} name="message" value={text} mentions={mentions} mentionsIn={mentionsIn}
        onValueChange={(value, next) => { drafts.set(draftKey, value); drafts.setDetails(draftKey, { mentions: next }); setStorageAvailable(drafts.available()); }}
        submitLabel={t("Save")} submitVerb="save" onSubmit={() => onSave(text, mentions)} pending={pending || sharedPending}
        onCancel={onCancel} escapeCancels error={error}
        notices={!storageAvailable && <FieldDescription role="status">{t("Browser storage is unavailable. Keep this page open to keep your draft.")}</FieldDescription>} />;
}
