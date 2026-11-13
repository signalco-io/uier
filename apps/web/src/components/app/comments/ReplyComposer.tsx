'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { type RefObject, useMemo, useState, useSyncExternalStore, useTransition } from 'react';
import { useAttachedImage } from '@uier/toolbar/attachments';
import { ReplyAttachment } from './ReplyAttachment';
import { toast } from 'sonner';
import { appCommentDrafts } from './replyDrafts';
import { Button } from '@/src/components/ui/button';
import { FieldDescription } from '@/src/components/ui/field';
import { replyCommentAction } from './actions';
import type { MessageMention } from './MentionEditor';
import { MessageComposer } from './MessageComposer';
import { useCommentUpdate, type SentReply } from './CommentUpdates';
import type { ProjectCommentView } from '../../../lib/app/projectComments';

const emptyMentions: MessageMention[] = [];
const maxLength = 1000;

/**
 * Mounted only for the card whose Reply action was opened: the shared `MessageComposer` with the thread's seven-day
 * draft. It has no close button: Escape in the empty field closes it (uier #288); with text, Escape is left to the thread.
 */
export function ReplyComposer({ projectId, userId, userName, comment, fieldRef, onClose, onSend }: {
    projectId: string; userId: string;
    /** The signed-in user's name, for the pending reply's avatar (the reply itself reads "You") */
    userName?: string;
    comment: ProjectCommentView;
    /** The reply box, for R to focus it rather than another open editor in the card */
    fieldRef?: RefObject<{ focus: () => void } | null>;
    /** Escape in the empty field */
    onClose: () => void;
    /**
     * A reply being sent: the card keeps showing it until the refreshed thread has the saved one, as the optimistic
     * reply ends with the send (uier #377). The returned function takes it back when the send fails.
     */
    onSend?: (sent: SentReply) => () => void;
}) {
    const { t } = useAppI18n();
    const drafts = useMemo(() => appCommentDrafts(projectId, userId, comment.id), [projectId, userId, comment.id]);
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
    const attachment = useAttachedImage(undefined, { pastedName: t("Pasted image") });

    const setText = (value: string, nextMentions: MessageMention[]) => {
        drafts.set(key, value);
        drafts.setDetails(key, { mentions: nextMentions });
        setStorageAvailable(drafts.available());
    };
    const submit = () => {
        const sentText = drafts.get(key) ?? '';
        if (!sentText.trim() || drafts.pending(key) || attachment.reading) return;
        const sentImage = attachment.image;
        const sentMentions = drafts.details(key)?.mentions ?? [];
        const leading = sentText.length - sentText.trimStart().length;
        const selectedMentions = sentMentions.filter(mention => mention.end <= sentText.trimEnd().length)
            .map(mention => ({ ...mention, start: mention.start - leading, end: mention.end - leading }));
        const input = { projectId, commentId: comment.id, text: sentText.trim(), mentions: selectedMentions };
        const idempotencyKey = drafts.attempt(key, JSON.stringify({ ...input, image: sentImage?.key }));
        const sendId = drafts.startSend(key, sentText, sentMentions);
        setError(undefined);
        setAnnouncement(t("Sending reply..."));
        attachment.remove();
        startTransition(async () => {
            let saved = false;
            let unsend: (() => void) | undefined;
            try {
                await drafts.run(key, async () => {
                    const sent: SentReply = { reply: { id: `pending-${sendId}`, author: { name: userName ?? t("You"), isMe: true }, text: input.text,
                        mentions: input.mentions.map(({ start, end }) => ({ start, end })), createdAt: new Date().toISOString(), deleted: false, edited: false, canDelete: false, canFilterAuthor: false, pending: true },
                    previousReplyIds: comment.replies.map(item => item.id) };
                    update({ id: comment.id, ...sent });
                    unsend = onSend?.(sent);
                    const result = await replyCommentAction({ ...input, idempotencyKey, screenshot: sentImage?.dataUrl });
                    if (!result?.ok) throw new Error(result?.error ?? t("Could not post the reply. Try again."));
                });
                saved = true;
                setAnnouncement(t("Reply posted"));
            } catch (failure) {
                unsend?.();
                if (sentImage) attachment.restore(sentImage);
                const message = failure instanceof Error ? failure.message : t("Could not post the reply. Try again.");
                setError(message);
                toast.error(t("Your reply was not posted."), { description: t("{value0} Your draft is kept.", { value0: message }) });
                setAnnouncement(t("Reply not posted. Your draft is kept."));
            } finally {
                drafts.settleSend(key, sendId, saved);
                setStorageAvailable(drafts.available());
            }
        });
    };

    return <MessageComposer label={t("Reply")} formLabel={t("Reply to thread")} name="reply" placeholder={t("Reply...")}
        value={text} mentions={mentions} onValueChange={setText} mentionsIn={{ projectId, commentId: comment.id }} maxLength={maxLength} fieldRef={fieldRef}
        attachments={<ReplyAttachment attachment={attachment} />} onPaste={attachment.handlePaste} onImageDrop={file => void attachment.attach(file)} holdSubmit={attachment.reading}
        submitLabel={t("Post reply")} submitVerb="send" onSubmit={submit} pending={pending}
        onEscapeEmpty={onClose}
        onDiscard={() => { attachment.remove(); drafts.delete(key); setError(undefined); setAnnouncement(t("Draft discarded")); }}
        error={(attachment.error && t(attachment.error)) || (error && t("{value0} Your draft is kept. Try sending again.", { value0: error }))} announcement={announcement}
        notices={<>
            {!storageAvailable && <FieldDescription role="status">{t("Browser storage is unavailable. Keep this page open to keep your draft.")}</FieldDescription>}
            {recoveries > 0 && <FieldDescription role="status">{t("Earlier unsent text is kept separately because both drafts exceed the character limit.")}
                <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => drafts.restore(key)}>{t("Restore unsent text")}</Button></FieldDescription>}
        </>} />;
}
