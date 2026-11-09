'use client';

import { type RefObject, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { toast } from 'sonner';
import { createDraftStore } from '@uier/toolbar/drafts';
import { Button } from '@/src/components/ui/button';
import { FieldDescription } from '@/src/components/ui/field';
import { replyCommentAction } from './actions';
import type { MessageMention } from './MentionTextarea';
import { MessageComposer } from './MessageComposer';
import { useCommentUpdate } from './CommentUpdates';
import type { ProjectCommentView } from '../../../lib/app/projectComments';

const emptyMentions: MessageMention[] = [];
const maxLength = 1000;

/** Mounted only for the card whose Reply action was opened: the shared `MessageComposer` with the thread's seven-day draft. */
export function ReplyComposer({ projectId, userId, userName, comment, textareaRef, onClose }: {
    projectId: string; userId: string;
    /** The signed-in user's name, for the pending reply's avatar (the reply itself reads "You") */
    userName?: string;
    comment: ProjectCommentView;
    /** The reply box, for R to focus it rather than another open editor in the card */
    textareaRef?: RefObject<HTMLTextAreaElement | null>;
    onClose: () => void;
}) {
    const drafts = useMemo(() => createDraftStore([typeof location === 'undefined' ? '' : location.origin, 'app', projectId, userId, comment.id]), [projectId, userId, comment.id]);
    const key = 'reply';
    const text = useSyncExternalStore(listener => drafts.subscribe(key, listener), () => drafts.get(key) ?? '', () => '');
    const mentions = useSyncExternalStore(listener => drafts.subscribe(key, listener), () => drafts.details(key)?.mentions ?? emptyMentions, () => emptyMentions);
    const pending = useSyncExternalStore(listener => drafts.subscribe(key, listener), () => drafts.pending(key), () => false);
    const recoveries = useSyncExternalStore(listener => drafts.subscribe(key, listener), () => drafts.recoveries(key), () => 0);
    const [storageAvailable, setStorageAvailable] = useState(drafts.available);
    const [error, setError] = useState<string>();
    const [announcement, setAnnouncement] = useState('');
    const [, startTransition] = useTransition();
    const update = useCommentUpdate();

    const setText = (value: string, nextMentions: MessageMention[]) => {
        drafts.set(key, value);
        drafts.setDetails(key, { mentions: nextMentions });
        setStorageAvailable(drafts.available());
    };
    const submit = () => {
        const sentText = drafts.get(key) ?? '';
        if (!sentText.trim() || drafts.pending(key)) return;
        const sentMentions = drafts.details(key)?.mentions ?? [];
        const leading = sentText.length - sentText.trimStart().length;
        const selectedMentions = sentMentions.filter(mention => mention.end <= sentText.trimEnd().length)
            .map(mention => ({ ...mention, start: mention.start - leading, end: mention.end - leading }));
        const input = { projectId, commentId: comment.id, text: sentText.trim(), mentions: selectedMentions };
        const idempotencyKey = drafts.attempt(key, JSON.stringify(input));
        const sendId = drafts.startSend(key, sentText, sentMentions);
        setError(undefined);
        setAnnouncement('Sending reply...');
        startTransition(async () => {
            let saved = false;
            try {
                await drafts.run(key, async () => {
                    update({ id: comment.id, reply: { id: `pending-${sendId}`, author: { name: userName ?? 'You', isMe: true }, text: input.text,
                        mentions: input.mentions.map(({ start, end }) => ({ start, end })), createdAt: new Date().toISOString(), deleted: false, edited: false, canDelete: false, canFilterAuthor: false, pending: true }, previousReplyIds: comment.replies.map(item => item.id) });
                    const result = await replyCommentAction({ ...input, idempotencyKey });
                    if (!result?.ok) throw new Error(result?.error ?? 'Could not post the reply. Try again.');
                });
                saved = true;
                setAnnouncement('Reply posted');
            } catch (failure) {
                const message = failure instanceof Error ? failure.message : 'Could not post the reply. Try again.';
                setError(message);
                toast.error('Your reply was not posted.', { description: `${message} Your draft is kept.` });
                setAnnouncement('Reply not posted. Your draft is kept.');
            } finally {
                drafts.settleSend(key, sendId, saved);
                setStorageAvailable(drafts.available());
            }
        });
    };

    return <MessageComposer label="Reply" formLabel="Reply to thread" name="reply" placeholder="Reply..."
        value={text} mentions={mentions} onValueChange={setText} mentionsIn={{ projectId, commentId: comment.id }} maxLength={maxLength} textareaRef={textareaRef}
        submitLabel="Post reply" submitVerb="send" onSubmit={submit} pending={pending}
        cancelLabel="Close reply" onCancel={onClose}
        onDiscard={() => { drafts.delete(key); setError(undefined); setAnnouncement('Draft discarded'); }}
        error={error && `${error} Your draft is kept. Try sending again.`} announcement={announcement}
        notices={<>
            {!storageAvailable && <FieldDescription role="status">Browser storage is unavailable. Keep this page open to keep your draft.</FieldDescription>}
            {recoveries > 0 && <FieldDescription role="status">Earlier unsent text is kept separately because both drafts exceed the character limit.
                <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => drafts.restore(key)}>Restore unsent text</Button></FieldDescription>}
        </>} />;
}
