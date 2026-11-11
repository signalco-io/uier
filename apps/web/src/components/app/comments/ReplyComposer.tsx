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
            try {
                await drafts.run(key, async () => {
                    update({ id: comment.id, reply: { id: `pending-${sendId}`, author: { name: userName ?? t("You"), isMe: true }, text: input.text,
                        mentions: input.mentions.map(({ start, end }) => ({ start, end })), createdAt: new Date().toISOString(), deleted: false, edited: false, canDelete: false, canFilterAuthor: false, pending: true }, previousReplyIds: comment.replies.map(item => item.id) });
                    const result = await replyCommentAction({ ...input, idempotencyKey, screenshot: sentImage?.dataUrl });
                    if (!result?.ok) throw new Error(result?.error ?? t("Could not post the reply. Try again."));
                });
                saved = true;
                setAnnouncement(t("Reply posted"));
            } catch (failure) {
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
        value={text} mentions={mentions} onValueChange={setText} mentionsIn={{ projectId, commentId: comment.id }} maxLength={maxLength} textareaRef={textareaRef}
        attachments={<ReplyAttachment attachment={attachment} />} onPaste={attachment.handlePaste} holdSubmit={attachment.reading}
        submitLabel={t("Post reply")} submitVerb="send" onSubmit={submit} pending={pending}
        cancelLabel={t("Close reply")} onCancel={onClose}
        onDiscard={() => { attachment.remove(); drafts.delete(key); setError(undefined); setAnnouncement(t("Draft discarded")); }}
        error={(attachment.error && t(attachment.error)) || (error && t("{value0} Your draft is kept. Try sending again.", { value0: error }))} announcement={announcement}
        notices={<>
            {!storageAvailable && <FieldDescription role="status">{t("Browser storage is unavailable. Keep this page open to keep your draft.")}</FieldDescription>}
            {recoveries > 0 && <FieldDescription role="status">{t("Earlier unsent text is kept separately because both drafts exceed the character limit.")}
                <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => drafts.restore(key)}>{t("Restore unsent text")}</Button></FieldDescription>}
        </>} />;
}
