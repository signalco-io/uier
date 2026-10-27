'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { Typography } from '@signalco/ui-primitives/Typography';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Avatar } from '@signalco/ui-primitives/Avatar';
import { CommentTime } from './CommentTime';
import { useComments } from '../hooks/useComments';
import { CommentThreadItemMenu } from './CommentThreadItemMenu';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { CommentKindLabel } from './CommentKindLabel';
import { CommentDeviceButton, CommentDeviceDetails, hasDeviceMeta } from './info/CommentDeviceMeta';
import { useReattach } from './CommentAnchorDetails';
import { CommentScreenshot } from './CommentScreenshot';
import { CommentComposer } from './CommentComposer';
import { useDrafts } from '../hooks/useDrafts';
import { CommentItem, CommentItemThreadItem } from './@types/Comments';

function parseDate(value: string | undefined) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? undefined : date;
}

export function avatarText(name: string) {
    // `Guest 1A2B` -> `1A`, so different visitors are easier to tell apart
    const guestCode = /^Guest ([0-9A-F]{2})/i.exec(name)?.[1];
    return (guestCode ?? name[0] ?? '?').toUpperCase();
}

/**
 * What deleting does, the same way the API decides it (apps/web/src/lib/comments/service.ts):
 * the first item takes the visitor's own replies with it, but when others replied only its text
 * goes and the thread stays; the last reply under a deleted first item takes the thread with it.
 */
function deleteConfirmText(comment: CommentItem, first: boolean | undefined) {
    const [firstItem, ...replies] = comment.thread.items;
    if (!first) {
        return firstItem?.deleted && replies.length === 1
            ? 'Delete this reply? It is the last message, so the thread is removed too.'
            : 'Delete this reply?';
    }

    // An admin of a project deleting someone else's comment removes the whole thread
    if (!comment.isMine) {
        return replies.length > 0 ? 'Delete this comment and its replies?' : 'Delete this comment?';
    }
    if (replies.some(reply => reply.deleted || !reply.author?.isMe)) {
        return 'Delete this comment? Its text is removed. The replies stay.';
    }
    return replies.length > 0
        ? `Delete this comment and your ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}?`
        : 'Delete this comment?';
}

export function CommentThreadItem({ comment, threadItem, first }: { comment: CommentItem, threadItem: CommentItemThreadItem; first?: boolean; }) {
    const { delete: deleteComment, deleteReply, edit } = useComments();
    const announce = useAnnounce();
    const reattach = useReattach(comment);
    const deviceDetailsId = useId();
    const [deviceOpen, setDeviceOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLButtonElement>(null);
    const drafts = useDrafts();
    const editDraftKey = `edit:${comment.id}:${threadItem.id}`;
    const sharedPending = useSyncExternalStore(
        listener => drafts.subscribe(editDraftKey, listener),
        () => drafts.pending(editDraftKey));
    const [editing, setEditing] = useState<{ originalText: string } | undefined>(() => {
        const saved = drafts.details(editDraftKey);
        return saved && typeof saved.originalText === 'string' ? { originalText: saved.originalText } : undefined;
    });

    // The author deleted it after others replied: a placeholder, without author or actions
    if (threadItem.deleted) {
        return (
            <Typography level="body1" className="pl-8 text-sm text-muted-foreground">Comment deleted</Typography>
        );
    }

    const { text } = threadItem;
    let displayText = text;
    for (const mention of (threadItem.mentions ?? []).slice().reverse())
        displayText = displayText.slice(0, mention.start) + `@${mention.name ?? 'Former member'}` + displayText.slice(mention.end);
    const quote: string | undefined = threadItem.quotedText;
    const authorName = threadItem.author?.name || 'Guest';
    const isMe = Boolean(threadItem.author?.isMe);
    const createdAt = parseDate(threadItem.createdAt);

    // Public actions belong to the author. Project DTOs include author/admin permissions.
    const canDelete = first ? (comment.permissions?.delete ?? comment.isMine) : (threadItem.canDelete ?? isMe);
    const canEdit = first ? (comment.permissions?.edit ?? comment.isMine) : (threadItem.canEdit ?? isMe);
    const pending = deleteComment.isPending || deleteReply.isPending || edit.isPending || sharedPending;
    const error = deleteComment.error ?? deleteReply.error;
    const finishEdit = () => {
        drafts.delete(editDraftKey);
        setEditing(undefined);
        requestAnimationFrame(() => menuRef.current?.focus());
    };

    const handleDelete = async () => {
        // The item's menu had the focus and goes away; the thread's messages list (in the popover
        // or the inbox) takes it, if it is still there
        const list = rootRef.current?.closest<HTMLElement>('[tabindex="0"]');
        try {
            if (first) {
                await deleteComment.mutateAsync(comment.id);
            } else {
                await deleteReply.mutateAsync({ commentId: comment.id, itemId: threadItem.id });
            }
        } catch {
            // Shown below the item
            return;
        }

        announce(first ? 'Comment deleted' : 'Reply deleted');
        if (list?.isConnected) {
            list.focus();
        }
    };

    const showDevice = first && hasDeviceMeta(comment.device, comment.reproduction);

    return (
        <div ref={rootRef} className="flex gap-2">
            <Avatar size="sm" aria-hidden="true" className="shrink-0 border bg-accent text-[11px] font-semibold text-foreground">{avatarText(authorName)}</Avatar>
            <Stack spacing={1} className="min-w-0 flex-1">
                <Row spacing={1} justifyContent="space-between" className="min-h-6">
                    <Row spacing={1} className="min-w-0">
                        <Typography level="body2" semiBold noWrap className="text-foreground" title={authorName}>
                            {isMe ? 'You' : authorName}
                        </Typography>
                        {createdAt && (
                            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                                <CommentTime date={createdAt} />
                            </span>
                        )}
                        {showDevice && (
                            <CommentDeviceButton
                                device={comment.device}
                                reproduction={comment.reproduction}
                                expanded={deviceOpen}
                                controls={deviceDetailsId}
                                onToggle={() => setDeviceOpen(!deviceOpen)} />
                        )}
                    </Row>
                    {(canDelete || canEdit) && !editing && (
                        <CommentThreadItemMenu
                            triggerRef={menuRef}
                            kind={first ? 'comment' : 'reply'}
                            own={isMe}
                            confirmText={deleteConfirmText(comment, first)}
                            disabled={pending}
                            onDelete={canDelete ? handleDelete : undefined}
                            onReattach={first && reattach.available ? reattach.request : undefined}
                            onEdit={canEdit ? () => {
                                edit.reset();
                                const existing = drafts.details(editDraftKey);
                                const snapshot = existing && typeof existing.originalText === 'string' ? existing : undefined;
                                if (!snapshot) {
                                    drafts.setDetails(editDraftKey, { originalText: text });
                                    if (!existing) drafts.set(editDraftKey, text);
                                }
                                setEditing({ originalText: snapshot?.originalText ?? text });
                            } : undefined} />
                    )}
                </Row>
                {showDevice && deviceOpen && (
                    <CommentDeviceDetails id={deviceDetailsId} device={comment.device} reproduction={comment.reproduction} />
                )}
                {first && <CommentKindLabel kind={comment.kind} />}
                {Boolean(quote?.length) && (
                    <blockquote className="m-0 line-clamp-4 border-l-2 border-border pl-2.5 text-sm text-secondary-foreground">
                        {quote}
                    </blockquote>
                )}
                {editing ? (
                    <CommentComposer label={first ? 'Edit comment' : 'Edit reply'} placeholder="Update the message" submitLabel="Save changes"
                        commentId={comment.id} initialMentions={threadItem.mentions} draftKey={editDraftKey} initialText={editing.originalText} autoFocus pending={edit.isPending} error={edit.error}
                        onCancel={finishEdit} onSubmit={async (text, mentions) => {
                            await edit.mutateAsync({ commentId: comment.id, itemId: threadItem.id, text, mentions, expectedText: editing.originalText });
                            finishEdit();
                            announce(first ? 'Comment edited' : 'Reply edited');
                        }} />
                ) : <Typography level="body1" className="whitespace-pre-wrap break-words text-sm">{displayText}{threadItem.editedAt && <span className="text-muted-foreground"> (edited)</span>}</Typography>}
                {first && <CommentScreenshot comment={comment} />}
                <CommentsErrorMessage error={error} />
            </Stack>
        </div>
    );
}
