'use client';

import { useMessages, type Messages } from '../i18n';
import { agentDescription } from '../i18n/format';

import { useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { Typography } from '@uier/ui-primitives/Typography';
import { Stack } from '@uier/ui-primitives/Stack';
import { Row } from '@uier/ui-primitives/Row';
import { Avatar } from '@uier/ui-primitives/Avatar';
import { cx } from '@uier/ui-primitives/cx';
import { CommentTime } from './CommentTime';
import { useComments } from '../hooks/useComments';
import { CommentThreadItemMenu } from './CommentThreadItemMenu';
import type { FirstMessageActions } from './CommentThreadMenu';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { CommentKindLabel } from './CommentKindLabel';
import { CommentDevice } from './info/CommentDevice';
import { useReattach } from './CommentAnchorDetails';
import { CommentScreenshot } from './CommentScreenshot';
import { CommentRecording } from './CommentRecording';
import { CommentAttach } from './CommentAttach';
import { CommentComposer } from './CommentComposer';
import { useDrafts } from '../hooks/useDrafts';
import { CommentItem, CommentItemThreadItem } from './@types/Comments';
import type { MessageAgentView } from '../agents';
import { AgentMark } from './AgentMark';
import { useIconTooltip } from './IconTooltip';
import { MessageMarkdown } from './MessageMarkdown';
import { ReactionList, ReactionPicker } from './MessageReactions';

/**
 * "via Claude" after a message's author, with the agent's logo: it wrote the message for them through a
 * coding tool connection. The tooltip and the name add the model and reasoning level members get.
 */
function MessageAgent({ agent }: { agent: MessageAgentView }) {
    const t = useMessages();
    const details = agentDescription(agent, t);
    const { triggerProps, tooltip } = useIconTooltip(t.thread.writtenBy(details));
    return <>
        <span role="img" tabIndex={-1} aria-label={t.thread.viaAgent(details)} data-message-agent={agent.kind} {...triggerProps}
            className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            {t.thread.via}
            <span className="inline-flex items-center gap-1 text-foreground"><AgentMark kind={agent.kind} />{agent.label}</span>
        </span>
        {tooltip}
    </>;
}

/**
 * A message's avatar names its author on hover or keyboard focus (uier #323): the full name, "(you)" and
 * the agent that wrote it for them, with the model and reasoning level members get.
 */
function MessageAuthorAvatar({ name, person, agent }: { name: string; person: string; agent?: MessageAgentView }) {
    const t = useMessages();
    const label = agent ? `${person}. ${t.thread.writtenBy(agentDescription(agent, t))}` : person;
    const { triggerProps, tooltip } = useIconTooltip(label, undefined, { prose: Boolean(agent) });
    return <>
        <Avatar size="sm" role="img" aria-label={label} tabIndex={0} {...triggerProps}
            className="shrink-0 border bg-accent text-[11px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {avatarText(name)}
        </Avatar>
        {tooltip}
    </>;
}

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
function deleteConfirmText(comment: CommentItem, first: boolean | undefined, t: Messages) {
    const [firstItem, ...replies] = comment.thread.items;
    if (!first) {
        return firstItem?.deleted && replies.length === 1
            ? t.thread.deleteLastReply
            : t.thread.deleteReply;
    }

    // An admin of a project deleting someone else's comment removes the whole thread
    if (!comment.isMine) {
        return replies.length > 0 ? t.thread.deleteCommentAndReplies : t.thread.deleteComment;
    }
    if (replies.some(reply => reply.deleted || !reply.author?.isMe)) {
        return t.thread.deleteCommentKeepReplies;
    }
    return replies.length > 0
        ? t.thread.deleteCommentAndYourReplies(replies.length)
        : t.thread.deleteComment;
}

/** The first message's part of the thread's header line: its author line, Add reaction, Attach to comment and its options */
export type ThreadHeaderMessage = { author?: ReactNode; device?: ReactNode; reaction?: ReactNode; attach?: ReactNode; actions?: FirstMessageActions };

/**
 * One message. A reply has its avatar column and its own header line with Add reaction and More options. The
 * first message is the thread itself (uier #470): with `header`, its author, time, device marks, Add reaction and
 * options go into the thread's header line (`CommentThreadHeader`, Thread options at `optionsRef`), and its
 * text sits right under that line.
 */
export function CommentThreadItem({ comment, threadItem, first, header, optionsRef }: {
    comment: CommentItem;
    threadItem: CommentItemThreadItem;
    first?: boolean;
    header?: (message: ThreadHeaderMessage) => ReactNode;
    optionsRef?: RefObject<HTMLButtonElement | null>;
}) {
    const { delete: deleteComment, deleteReply, edit } = useComments();
    const t = useMessages();
    const announce = useAnnounce();
    const reattach = useReattach(comment);
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
    // Under the first message: what its Attach is saving, or a recording waiting to be attached (`CommentAttach`)
    const [attachPanel, setAttachPanel] = useState<HTMLDivElement | null>(null);

    // The first message's author and actions are in the thread's header line
    const merged = Boolean(first && header);

    // The author deleted it after others replied: a placeholder, without author or actions
    if (threadItem.deleted) {
        const placeholder = <Typography level="body1" className={cx('text-sm text-muted-foreground', !merged && 'pl-8')}>{t.thread.commentDeleted}</Typography>;
        return merged ? <div className="flex flex-col gap-1">{header?.({})}{placeholder}</div> : placeholder;
    }

    const { text } = threadItem;
    const mentions = threadItem.mentions?.map(mention => ({ start: mention.start, end: mention.end, name: mention.name ?? t.thread.formerMember }));
    const quote: string | undefined = threadItem.quotedText;
    const authorName = threadItem.author?.name || t.common.guest;
    const isMe = Boolean(threadItem.author?.isMe);
    // "Ana via Claude": the name ends with the agent that wrote it, shown with its logo
    const agent = threadItem.agent;
    const via = agent ? ` via ${agent.label}` : '';
    const person = via && authorName.endsWith(via) ? authorName.slice(0, -via.length) : authorName;
    const createdAt = parseDate(threadItem.createdAt);

    // Public actions belong to the author. Project DTOs include author/admin permissions.
    const canDelete = first ? (comment.permissions?.delete ?? comment.isMine) : (threadItem.canDelete ?? isMe);
    const canEdit = first ? (comment.permissions?.edit ?? comment.isMine) : (threadItem.canEdit ?? isMe);
    const pending = deleteComment.isPending || deleteReply.isPending || edit.isPending || sharedPending;
    const error = deleteComment.error ?? deleteReply.error;
    const finishEdit = () => {
        drafts.delete(editDraftKey);
        setEditing(undefined);
        requestAnimationFrame(() => (merged ? optionsRef : menuRef)?.current?.focus());
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

        announce(first ? t.thread.commentDeleted : t.thread.replyDeleted);
        if (list?.isConnected) {
            list.focus();
        }
    };

    const startEdit = () => {
        edit.reset();
        const existing = drafts.details(editDraftKey);
        const snapshot = existing && typeof existing.originalText === 'string' ? existing : undefined;
        if (!snapshot) {
            drafts.setDetails(editDraftKey, { originalText: text });
            if (!existing) drafts.set(editDraftKey, text);
        }
        setEditing({ originalText: snapshot?.originalText ?? text });
    };

    const authorLine = <>
        <Typography level="body2" semiBold noWrap className="min-w-0 text-foreground" title={authorName}>
            {isMe ? t.thread.you : agent ? person : authorName}
        </Typography>
        {agent && <MessageAgent agent={agent} />}
        {createdAt && (
            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                <CommentTime date={createdAt} />
            </span>
        )}
        {first && !merged && <CommentDevice device={comment.device} reproduction={comment.reproduction} />}
    </>;

    const body = (
        <Stack spacing={1} className="min-w-0">
            {first && <CommentKindLabel kind={comment.kind} feedbackType={comment.feedbackType} />}
            {Boolean(quote?.length) && (
                <blockquote className="m-0 line-clamp-4 border-l-2 border-border pl-2.5 text-sm text-secondary-foreground">
                    {quote}
                </blockquote>
            )}
            {editing ? (
                <CommentComposer label={first ? t.thread.editComment : t.thread.editReply} placeholder={t.thread.editPlaceholder} submitLabel={t.thread.saveChanges}
                    commentId={comment.id} initialMentions={threadItem.mentions} draftKey={editDraftKey} initialText={editing.originalText} autoFocus pending={edit.isPending} error={edit.error}
                    onCancel={finishEdit} onSubmit={async (text, mentions) => {
                        await edit.mutateAsync({ commentId: comment.id, itemId: threadItem.id, text, mentions, expectedText: editing.originalText });
                        finishEdit();
                        announce(first ? t.thread.commentEdited : t.thread.replyEdited);
                    }} />
            ) : <MessageMarkdown text={text} mentions={mentions}
                suffix={threadItem.editedAt && <span className="font-normal text-muted-foreground">{t.thread.edited}</span>} />}
            {(first || threadItem.screenshot) && <CommentScreenshot comment={comment} itemId={first ? undefined : threadItem.id} />}
            {(first ? comment.recording : threadItem.recording) && <CommentRecording commentId={comment.id} itemId={first ? undefined : threadItem.id} recording={(first ? comment.recording : threadItem.recording)!} />}
            {first && <div ref={setAttachPanel} data-uier-attach-panel="" className="flex min-w-0 flex-col gap-1 empty:hidden" />}
            {!editing && <ReactionList comment={comment} item={threadItem} />}
            <CommentsErrorMessage error={error} />
        </Stack>
    );

    if (merged) {
        // Its options join Thread options; while it is edited they wait, like a reply's menu
        const actions: FirstMessageActions | undefined = editing || !(canDelete || canEdit) ? undefined : {
            disabled: pending,
            onEdit: canEdit ? startEdit : undefined,
            onReattach: reattach.available ? reattach.request : undefined,
            delete: canDelete ? { confirmText: deleteConfirmText(comment, first, t), onDelete: () => void handleDelete() } : undefined
        };
        return (
            <div ref={rootRef} className="flex flex-col gap-1">
                {header?.({
                    author: authorLine,
                    device: <CommentDevice device={comment.device} reproduction={comment.reproduction} />,
                    reaction: !editing && <ReactionPicker comment={comment} item={threadItem} disabled={pending} />,
                    attach: !editing && <CommentAttach comment={comment} panel={attachPanel} disabled={pending} />,
                    actions
                })}
                {body}
            </div>
        );
    }

    return (
        <div ref={rootRef} className="flex gap-2">
            <MessageAuthorAvatar name={authorName} person={isMe ? t.thread.authorYou(person) : person} agent={agent} />
            {/* The author line and the message almost touch (uier #240); the rest keeps its spacing */}
            <div className="flex min-w-0 flex-1 flex-col">
                <Row spacing={1} justifyContent="space-between" className="min-h-6">
                    <Row spacing={1} className="min-w-0">
                        {authorLine}
                    </Row>
                    <Row spacing={0.5} className="shrink-0">
                        {!editing && <ReactionPicker comment={comment} item={threadItem} disabled={pending} />}
                        {first && !editing && <CommentAttach comment={comment} panel={attachPanel} disabled={pending} />}
                        {(canDelete || canEdit) && !editing && (
                            <CommentThreadItemMenu
                                triggerRef={menuRef}
                                kind={first ? 'comment' : 'reply'}
                                own={isMe}
                                confirmText={deleteConfirmText(comment, first, t)}
                                disabled={pending}
                                onDelete={canDelete ? handleDelete : undefined}
                                onReattach={first && reattach.available ? reattach.request : undefined}
                                onEdit={canEdit ? startEdit : undefined} />
                        )}
                    </Row>
                </Row>
                {body}
            </div>
        </div>
    );
}
