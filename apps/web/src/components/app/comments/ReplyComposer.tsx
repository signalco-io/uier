'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { SendIcon } from 'lucide-react';
import { toast } from 'sonner';
import { createDraftStore } from '@uier/toolbar/drafts';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Spinner } from '@/src/components/ui/spinner';
import { replyCommentAction } from './actions';
import { MentionTextarea, type MessageMention } from './MentionTextarea';
import { useCommentUpdate } from './CommentUpdates';
import type { ProjectCommentView } from '../../../lib/app/projectComments';

const emptyMentions: MessageMention[] = [];
const maxLength = 1000;

/** Mounted only for the card whose Reply action was opened. */
export function ReplyComposer({ projectId, userId, userName, comment, onClose }: {
    projectId: string; userId: string;
    /** The signed-in user's name, for the pending reply's avatar (the reply itself reads "You") */
    userName?: string;
    comment: ProjectCommentView; onClose: () => void;
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
    const textarea = useRef<HTMLTextAreaElement>(null);
    const form = useRef<HTMLFormElement>(null);
    const inputId = useId();
    const hintId = useId();

    useEffect(() => {
        const input = textarea.current;
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
    }, []);
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

    return <form ref={form} onSubmit={event => { event.preventDefault(); submit(); }} aria-label="Reply to thread">
        <FieldGroup className="gap-2">
            <Field data-invalid={error ? true : undefined} className="gap-2">
                <FieldLabel htmlFor={inputId} className="sr-only">Reply</FieldLabel>
                <MentionTextarea projectId={projectId} commentId={comment.id} value={text} mentions={mentions} maxLength={maxLength} textareaRef={textarea}
                    onValueChange={setText} onSubmit={() => form.current?.requestSubmit()} onMention={name => setAnnouncement(`Mentioned ${name}`)}
                    id={inputId} name="reply" rows={2} placeholder="Reply..."
                    className="max-h-44 resize-none overflow-y-auto" aria-describedby={hintId} aria-invalid={error ? true : undefined} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldDescription id={hintId} className="m-0 text-xs">{text.length >= 900 ? `${text.length}/${maxLength} characters` : '@ to mention · Shift+Enter for a new line'}</FieldDescription>
                    <div className="ml-auto flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" onClick={onClose}>Close reply</Button>
                        {text.length > 0 && <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" onClick={() => { drafts.delete(key); setError(undefined); setAnnouncement('Draft discarded'); }}>Discard</Button>}
                        <Button type="submit" variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={!text.trim() || pending}>
                            {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}Post reply
                        </Button>
                    </div>
                </div>
                {error && <FieldError role="alert">{error} Your draft is kept. Try sending again.</FieldError>}
                {!storageAvailable && <FieldDescription role="status">Browser storage is unavailable. Keep this page open to keep your draft.</FieldDescription>}
                {recoveries > 0 && <FieldDescription role="status">Earlier unsent text is kept separately because both drafts exceed the character limit.
                    <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => drafts.restore(key)}>Restore unsent text</Button></FieldDescription>}
            </Field>
        </FieldGroup>
        <p role="status" className="sr-only">{announcement}</p>
    </form>;
}
