'use client';

import { commentKindIcon, commentKindLabel, type FeedbackTypeSnapshot } from '@uier/toolbar/feedback-types';
import { FeedbackTypeIcon } from '../FeedbackTypeIcon';

import { PriorityControl } from './PriorityControl';
import { useCommitCommentsSearch } from './CommentsSearchNavigation';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
    ArrowLeftIcon,
    ArrowUpRightIcon,
    BellIcon,
    BellOffIcon,
    ChevronDownIcon,
    LockIcon,
    LockOpenIcon,
    MailIcon,
    MoreHorizontalIcon,
    PencilIcon,
    ReplaceIcon,
    ReplyIcon,
    Trash2Icon,
    UserIcon
} from 'lucide-react';
import { toast } from 'sonner';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/src/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/src/components/ui/avatar';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { cn } from '@/src/lib/utils';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '@/src/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { Spinner } from '@/src/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { ThreadTitle } from './ThreadTitle';
import { ThreadPullRequests } from './ThreadPullRequests';
import type { MessageMentionRange, ProjectCommentMessage, ProjectCommentView } from '../../../lib/app/projectComments';
import { MessageMarkdown } from './MessageMarkdown';
import type { ActionState } from '../../../lib/app/actionResult';
import type { DbCommentKind } from '../../../lib/db/schema';
import { initials } from '../initials';
import { RelativeTime } from './DateTime';
import { CommentDevice } from './CommentDevice';
import { SelectorCode } from './SelectorCode';
import { updateNotificationAction } from './notificationActions';
import { CopyIssueResult, CopyMenu, useCopyIssue } from './CopyIssue';
import { integrationLabels } from './commentLabels';
import { useCommentUpdate } from './CommentUpdates';
import { useReadWhenShown } from './useReadWhenShown';
import { VerificationControl } from './VerificationControl';
import { StateBadge, StateMenu, type CommentStatus } from './CommentStatus';
import { useStatusChange, type ResolveExit } from './useStatusChange';
import { ReplyComposer } from './ReplyComposer';
import { ThreadActivity } from './ThreadActivity';
import { AssigneesControl } from './AssigneesControl';
import { MessageAgent } from './MessageAgent';
import { MessageEditor } from './MessageEditor';
import type { MessageMention } from './MentionTextarea';
import { useKeyShortcutLabel, useKeyShortcuts } from '../keyboard/keys';
import {
    markCommentReadAction,
    markCommentUnreadAction,
    deleteCommentAction,
    deleteCommentReplyAction,
    editCommentReplyAction,
    filterCommentAuthorAction,
    editCommentAction,
    setCommentPrivateAction,
} from './actions';

export type AssigneeOption = { userId: string; name: string; avatarUrl?: string };

export type { ResolveExit } from './useStatusChange';

/** Who sees a private thread (`canSeeComment`): the workspace admins and its author */
const privateHint = 'Only workspace admins and the author can see this thread. Other members and guests cannot.';

/**
 * The blue dot of a thread with activity the reader has not read (the toolbar's `UnreadDot`).
 * It is the Mark as read button; Mark as unread is in the More actions menu.
 */
function UnreadDot({ disabled, onRead }: { disabled: boolean; onRead: () => void }) {
    return (
        <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Unread. Mark as read" disabled={disabled} onClick={onRead}
                    className="-mx-1.5 shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11" />}>
                <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />
            </TooltipTrigger>
            <TooltipContent>Mark as read</TooltipContent>
        </Tooltip>
    );
}

/**
 * Who the comment is assigned to: their avatar at 20px, smaller than the messages' so it sits in the
 * line beside the name, or the same avatar empty with a dashed outline while unassigned (as a pending
 * invitation's). Not `size="sm"`: its `data-[size=sm]:size-6` would win over `size-5`.
 */


/** A thread detail's label and value: one row height for text and controls alike (`h-7` ghost controls fit) */
const detailLabelClass = 'flex h-8 items-center text-muted-foreground pointer-coarse:h-11';
const detailValueClass = 'm-0 flex min-h-8 min-w-0 flex-wrap items-center pointer-coarse:min-h-11';

/** "Feedback", "Bug report" or "Suggested rewrite" above the first message, as in the toolbar */
function KindLabel({ kind, feedbackType }: { kind: DbCommentKind; feedbackType?: FeedbackTypeSnapshot }) {
    if (kind === 'comment')
        return null;
    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-secondary-foreground">
            {kind === 'rewrite' ? <ReplaceIcon aria-hidden="true" className="size-3.5" /> : <FeedbackTypeIcon icon={commentKindIcon(kind, feedbackType)} className="size-3.5" />}
            {commentKindLabel(kind, feedbackType)}
        </span>
    );
}

/** One message of the thread: the avatar makes the column, as in the toolbar's thread */
function Message({ author, agent, avatarName, avatarUrl, createdAt, meta, actions, children }: {
    /** As shown: "You" for your own messages */
    author: string;
    /** "via Claude": the AI agent that wrote it for the author */
    agent?: ReactNode;
    /** The person's name, for the avatar's initial ("You" would make every own avatar a Y) */
    avatarName: string;
    /** Their profile picture, when they have one */
    avatarUrl?: string;
    createdAt?: string;
    /** After the time: the screen and browser the comment was left from */
    meta?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex gap-2.5">
            <Avatar size="sm" aria-hidden="true" className="mt-0.5">
                {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
                <AvatarFallback className="font-semibold text-foreground">{initials(avatarName)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-h-7 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="truncate font-medium">{author}</span>
                        {agent}
                        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums"><RelativeTime value={createdAt} /></span>
                        {meta}
                    </div>
                    {actions}
                </div>
                {children}
            </div>
        </div>
    );
}

/** The text of a message with its Markdown, "(edited)" after it as in the toolbar */
function MessageText({ text, mentions, edited }: { text: string; mentions?: MessageMentionRange[]; edited: boolean }) {
    return <MessageMarkdown text={text} mentions={mentions} suffix={edited && <span className="font-normal text-muted-foreground"> (edited)</span>} />;
}

/**
 * A project comment in the app's list and board, laid out like the toolbar's thread: status, number,
 * who it is assigned to and actions (following the thread among them) on one row, then the messages,
 * the linked issues, and the page it was left on at the bottom. It is the open thread: once it has been
 * on screen for a moment it is marked read (`useReadWhenShown`), except after Mark as unread.
 */
export function CommentCard({ projectId, comment, reviewLink, assignees, userId, onMove, onBack, onReadWhenShown, startVerifying = false, className }: {
    projectId: string;
    comment: ProjectCommentView;
    /** Review link that opens the page at this comment */
    reviewLink: string;
    assignees: AssigneeOption[];
    /** The signed-in user: "Assigned to you" in the assignee's tooltip */
    userId: string;
    /** A status change that takes the comment out of its list starts its exit right away (`undefined`: it stays) */
    onMove?: (status: CommentStatus) => ResolveExit | undefined;
    /** Back to the list, where the thread takes the whole width (a phone): the button is shown only then */
    onBack?: () => void;
    /** The thread is being marked read because it was shown */
    onReadWhenShown?: () => void;
    /** Opens with the Request verification form (a card dropped on Ready to verify) */
    startVerifying?: boolean;
    className?: string;
}) {
    const router = useRouter();
    const updateComment = useCommentUpdate();
    const [replying, setReplying] = useState(false);
    const commitSearch = useCommitCommentsSearch();
    const [pending, startTransition] = useTransition();
    const [editing, setEditing] = useState(false);
    const [editError, setEditError] = useState<string>();
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const copyIssue = useCopyIssue(projectId, comment.id);
    const [confirmingReply, setConfirmingReply] = useState<string>();
    // The message being edited in place: the saved text it started from (the edit's `expectedText`) and, after a
    // failed save, the text that was tried and why it failed
    const [editingReply, setEditingReply] = useState<{ id: string; expectedText: string; text: string; mentions: MessageMention[]; error?: string }>();
    // The reply whose More actions takes the focus back once its edit closes and nothing is pending
    const replyActionsFocus = useRef<string>(undefined);
    // The Request verification form, opened from the status menu
    const [verifying, setVerifying] = useState(startVerifying);
    const statusTrigger = useRef<HTMLButtonElement>(null);
    const { permissions, source } = comment;
    const statusChange = useStatusChange(projectId, comment, {
        onMove,
        onVerify: () => setVerifying(true)
    });
    const changeStatus = (next: CommentStatus) => {
        if (next !== 'ready') setVerifying(false);
        statusChange.change(next);
    };
    const author = comment.author.isMe ? 'You' : comment.author.name;
    const label = comment.deleted ? 'Deleted comment' : `Comment by ${comment.author.isMe ? 'you' : comment.author.name}`;
    const unread = Boolean(comment.activity?.unread);
    // Only someone else's activity can be unread
    const canMarkUnread = !unread && Boolean(comment.activity?.lastOtherSequence);
    // Mark as unread keeps the thread unread while it stays open; opening it again reads it
    const [keptUnread, setKeptUnread] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);
    useReadWhenShown(cardRef, projectId, comment, { enabled: !keptUnread, onRead: onReadWhenShown });
    // R, S and A: reply, the status menu and the assignee menu of the thread on screen (not of one a phone keeps
    // hidden until its row is chosen). The menus open as Enter opens them, with their first item highlighted.
    const assigneeTrigger = useRef<HTMLButtonElement>(null);
    // The reply box itself: an open message editor in the same card is another textarea
    const replyField = useRef<HTMLTextAreaElement>(null);
    const shown = () => Boolean(cardRef.current?.checkVisibility());
    const openMenu = (trigger: HTMLButtonElement | null) => {
        if (!trigger || trigger.disabled || !shown()) return false;
        trigger.focus();
        trigger.click();
    };
    useKeyShortcuts({
        r: () => {
            if (!permissions.reply || !shown()) return false;
            if (replying) replyField.current?.focus();
            else setReplying(true);
        },
        s: () => openMenu(statusTrigger.current),
        a: () => openMenu(assigneeTrigger.current)
    });
    const replyShortcut = useKeyShortcutLabel('R');
    const statusShortcut = useKeyShortcutLabel('S');
    const assigneeShortcut = useKeyShortcutLabel('A');
    // After the page link: the environment's name; the address itself is in the link
    const sourceText = source.available
        ? source.label !== source.origin ? source.label : undefined
        : `${source.label}${source.origin && source.origin !== source.label ? ` · ${source.origin}` : ''} · Original source unavailable`;


    const run = (action: () => Promise<ActionState>, success?: string, patch?: Partial<ProjectCommentView>) => startTransition(async () => {
        if (patch) updateComment({ id: comment.id, patch });
        let result: ActionState;
        try { result = await action(); }
        catch { toast.error('Could not save the change. Try again.'); return; }
        if (result && !result.ok) {
            toast.error(result.error);
            return;
        }
        if (success)
            toast.success(success);
        // The server action already revalidates this page and returns its fresh snapshot.
    });

    const filterAuthor = (itemId?: string) => startTransition(async () => {
        commitSearch();
        const result = await filterCommentAuthorAction(projectId, comment.id, itemId);
        if (!result?.ok) {
            toast.error(result?.error ?? 'Could not filter by this author.');
            return;
        }
        const params = new URLSearchParams(window.location.search);
        params.set('author', result.data);
        params.delete('people');
        router.push(`/app/projects/${projectId}?${params}#comments`);
    });

    const copyLink = async () => {
        try {
            if (!source.available) return;
            await navigator.clipboard.writeText(new URL(reviewLink, window.location.href).toString());
            toast.success('Link copied. It opens the page at this comment.');
        } catch {
            toast.error('Couldn\'t copy the link.');
        }
    };

    // The first message is edited in place like a reply. Choosing Edit leaves the focus in the editor (the menu
    // does not take it back); the thread's More actions takes it once the edit closes and nothing is pending.
    const threadActions = useRef<HTMLButtonElement>(null);
    const editChosen = useRef(false);
    const threadActionsFocus = useRef(false);
    const closeEdit = () => {
        threadActionsFocus.current = true;
        setEditing(false);
    };
    useEffect(() => {
        if (!threadActionsFocus.current || pending || editing) return;
        threadActionsFocus.current = false;
        threadActions.current?.focus();
    }, [pending, editing]);
    const saveEdit = (text: string) => startTransition(async () => {
        let result: ActionState;
        try { result = await editCommentAction(projectId, comment.id, text); }
        catch { result = { ok: false, error: 'Could not save the change. Try again.' }; }
        if (result && !result.ok) {
            setEditError(result.error);
            return;
        }
        closeEdit();
    });

    useEffect(() => {
        const id = replyActionsFocus.current;
        if (!id || pending || editingReply) return;
        replyActionsFocus.current = undefined;
        cardRef.current?.querySelector<HTMLElement>(`[data-reply-actions="${CSS.escape(id)}"]`)?.focus();
    }, [pending, editingReply]);

    const closeReplyEdit = (id: string) => {
        replyActionsFocus.current = id;
        setEditingReply(undefined);
    };

    /** Saves an edited message as the toolbar does: trimmed, its mentions moved with it, shown at once */
    const saveReply = (item: ProjectCommentMessage, expectedText: string, text: string, mentions: MessageMention[]) => {
        const leading = text.length - text.trimStart().length;
        const sent = text.trim();
        const sentMentions = mentions.filter(mention => mention.start >= leading && mention.end <= text.trimEnd().length)
            .map(mention => ({ ...mention, start: mention.start - leading, end: mention.end - leading }));
        const unchanged = sent === expectedText && JSON.stringify(sentMentions) === JSON.stringify(item.editable?.mentions ?? []);
        closeReplyEdit(item.id);
        if (unchanged) return;
        startTransition(async () => {
            updateComment({ id: comment.id, patch: { replies: comment.replies.map(current => current.id === item.id ? {
                ...current, text: sent, mentions: sentMentions.length ? sentMentions.map(({ start, end }) => ({ start, end })) : undefined,
                edited: true, editable: { text: sent, mentions: sentMentions }
            } : current) } });
            let result: ActionState;
            try { result = await editCommentReplyAction(projectId, comment.id, item.id, sent, expectedText, sentMentions); }
            catch { result = { ok: false, error: 'Could not save the change. Try again.' }; }
            // The tried text stays in the field with the reason, as the toolbar keeps it
            if (result && !result.ok) setEditingReply({ id: item.id, expectedText, text, mentions, error: result.error });
        });
    };

    const reply = (item: ProjectCommentMessage) => {
        const name = item.author.isMe ? 'You' : item.author.name;
        const edit = editingReply?.id === item.id && item.editable ? editingReply : undefined;
        const editable = item.editable;
        return (
            <Message author={name} agent={!item.deleted && <MessageAgent author={item.author} />} avatarName={item.author.name} avatarUrl={item.author.avatarUrl} createdAt={item.createdAt}
                actions={!item.deleted && !edit && (item.canDelete || item.canFilterAuthor || editable) && (
                    <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" disabled={pending} className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                                data-reply-actions={item.id} aria-label={`More actions for reply by ${item.author.isMe ? 'you' : item.author.name}`} />}>
                            <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-auto min-w-48">
                            <DropdownMenuGroup>
                                {editable && (
                                    <DropdownMenuItem onClick={() => setEditingReply({ id: item.id, expectedText: editable.text, text: editable.text, mentions: editable.mentions })}>
                                        <PencilIcon />
                                        Edit
                                    </DropdownMenuItem>
                                )}
                                {item.canFilterAuthor && (
                                    <DropdownMenuItem onClick={() => filterAuthor(item.id)}>
                                        <UserIcon />
                                        More from this author
                                    </DropdownMenuItem>
                                )}
                                {item.canDelete && (
                                    <DropdownMenuItem variant="destructive" onClick={() => setConfirmingReply(item.id)}>
                                        <Trash2Icon />
                                        Delete reply
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}>
                {item.deleted
                    ? <p className="m-0 text-sm text-muted-foreground">Reply deleted</p>
                    : edit
                        ? <MessageEditor mentionsIn={{ projectId, commentId: comment.id }} label="Edit reply"
                            text={edit.text} mentions={edit.mentions} error={edit.error}
                            onCancel={() => closeReplyEdit(item.id)} onSave={(text, mentions) => saveReply(item, edit.expectedText, text, mentions)} />
                        : <><MessageText text={item.text} mentions={item.mentions} edited={item.edited} />{item.pending && <span role="status" className="text-xs text-muted-foreground">Sending...</span>}</>}
            </Message>
        );
    };

    const { anchor } = comment;
    return (
        <Card ref={cardRef} role="article" aria-label={label} className={cn('@container/comment gap-0 py-0', className)}>
            <div className="flex flex-col gap-4 px-4 py-3">
                {/* Status, public id and unread on the left; Copy and More actions on the right, on one line at any width */}
                <div className="flex items-center gap-2">
                    {onBack && (
                        <Button variant="ghost" size="icon-sm" aria-label="Back to comments" onClick={onBack}
                            className="-ml-2 shrink-0 @3xl/comments:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                            <ArrowLeftIcon />
                        </Button>
                    )}
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {Object.values(statusChange.allowed).some(Boolean)
                            ? <StateMenu status={statusChange.status} allowed={statusChange.allowed} disabled={pending || statusChange.pending} onChange={changeStatus} triggerRef={statusTrigger} keyShortcut={statusShortcut} />
                            : <StateBadge status={statusChange.status} />}
                        {comment.number !== undefined && (
                            <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                <span className="sr-only">Comment </span>#{comment.number}
                            </span>
                        )}
                        {unread && (
                            <UnreadDot disabled={pending}
                                onRead={() => run(() => markCommentReadAction(projectId, comment.id, comment.activity!.sequence), undefined,
                                    { activity: { ...comment.activity!, readSequence: comment.activity!.sequence, unread: false } })} />
                        )}
                        {comment.private && (
                            <Tooltip>
                                {/* No background, so it sits quietly beside the number; the lock and the tooltip carry it */}
                                <TooltipTrigger render={<Badge variant="ghost" tabIndex={0} className="cursor-default text-muted-foreground outline-none hover:bg-transparent dark:hover:bg-transparent" />}>
                                    <LockIcon aria-hidden="true" data-icon="inline-start" />
                                    Private
                                    <span className="sr-only">. {privateHint}</span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-64">{privateHint}</TooltipContent>
                            </Tooltip>
                        )}
                    </div>
                    <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
                        <CopyMenu copyIssue={copyIssue} canCopyLink={source.available} onCopyLink={copyLink} />
                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger render={<DropdownMenuTrigger render={<Button ref={threadActions} variant="ghost" size="icon-sm" disabled={pending} aria-label={`More actions for the ${label.toLowerCase()}`}
                                    className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11" />} />}>
                                    {pending ? <Spinner /> : <MoreHorizontalIcon />}
                                </TooltipTrigger>
                                <TooltipContent>More actions</TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end" className="min-w-48" finalFocus={() => {
                                if (!editChosen.current) return true;
                                editChosen.current = false;
                                return false;
                            }}>
                                <DropdownMenuGroup>
                                    <DropdownMenuItem
                                        onClick={() => run(
                                            () => updateNotificationAction(projectId, comment.id, !comment.following),
                                            comment.following ? 'You no longer follow this thread.' : 'You follow this thread now.', { following: !comment.following })}>
                                        {comment.following ? <BellOffIcon /> : <BellIcon />}
                                        {comment.following ? 'Unfollow thread' : 'Follow thread'}
                                    </DropdownMenuItem>
                                    {canMarkUnread && (
                                        <DropdownMenuItem onClick={() => {
                                            setKeptUnread(true);
                                            run(() => markCommentUnreadAction(projectId, comment.id), undefined,
                                                { activity: { ...comment.activity!, readSequence: Math.max(0, comment.activity!.lastOtherSequence - 1), unread: true } });
                                        }}>
                                            <MailIcon />
                                            Mark as unread
                                        </DropdownMenuItem>
                                    )}
                                    {permissions.edit && (
                                        <DropdownMenuItem
                                            onClick={() => {
                                                editChosen.current = true;
                                                setEditError(undefined);
                                                setEditing(true);
                                            }}>
                                            <PencilIcon />
                                            Edit
                                        </DropdownMenuItem>
                                    )}
                                    {permissions.makePrivate && (
                                        <DropdownMenuItem
                                            onClick={() => run(
                                                () => setCommentPrivateAction(projectId, comment.id, !comment.private),
                                                comment.private ? 'Everyone with access sees this comment again.' : 'Only admins and the author see this comment now.')}>
                                            {comment.private ? <LockOpenIcon /> : <LockIcon />}
                                            {comment.private ? 'Make public' : 'Make private'}
                                        </DropdownMenuItem>
                                    )}
                                    {comment.canFilterAuthor && (
                                        <DropdownMenuItem onClick={() => filterAuthor()}>
                                            <UserIcon />
                                            More from this author
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuGroup>
                                {permissions.delete && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
                                            <Trash2Icon />
                                            Delete
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                <ThreadTitle key={`${comment.id}-title`} projectId={projectId} commentId={comment.id} title={comment.title} byAi={comment.titleByAi} canRename={permissions.title} />
                <CopyIssueResult state={copyIssue} />

                {/* From the most abstract to the most detailed: the page (it opens the review there) and its environment, the
                    element or text, who has it, its priority, then its pull requests.
                    A properties list: every row is one control tall (44px on touch screens), labels and values centred on it,
                    and a ghost control pulled left by its padding so its text starts where plain text does. */}
                <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 text-sm" data-thread-details>
                    <dt className={detailLabelClass}>Page</dt>
                    <dd className={`${detailValueClass} gap-x-2`}>
                        {source.available ? (
                            <a href={reviewLink} target="_blank" rel="noopener"
                                className="-mx-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 text-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11">
                                <span className="sr-only">Open on </span>
                                <span className="truncate font-mono text-xs">{comment.url.replace(/^https?:\/\//, '')}</span>
                                <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                            </a>
                        ) : <span className="truncate font-mono text-xs">{comment.path}</span>}
                        {sourceText && <span className="min-w-0 truncate text-xs text-muted-foreground">{sourceText}</span>}
                    </dd>
                    <dt className={detailLabelClass}>On</dt>
                    {/* The selector beside the label while it fits, else on its own line; padded so its first line sits where a one-line row's does */}
                    <dd className="m-0 flex min-h-8 min-w-0 flex-wrap items-baseline gap-x-2 py-1.5 pointer-coarse:min-h-11 pointer-coarse:py-3">
                        <span className="min-w-0 break-words">{anchor.label}</span>
                        {(anchor.type === 'element' || anchor.type === 'area') && (
                            <SelectorCode selector={anchor.selector} className="min-w-0" />
                        )}
                        {anchor.type === 'text' && anchor.text && (
                            <blockquote className="m-0 mt-1 line-clamp-4 basis-full border-l-2 border-border pl-2.5 text-secondary-foreground">{anchor.text}</blockquote>
                        )}
                    </dd>
                    <dt className={detailLabelClass}>Assignees</dt>
                    <dd className={detailValueClass}>
                        <AssigneesControl projectId={projectId} comment={comment} userId={userId} options={assignees} trigger={assigneeTrigger} shortcut={assigneeShortcut} />
                    </dd>
                    <dt className={detailLabelClass}>Priority</dt>
                    <dd className={detailValueClass}><PriorityControl projectId={projectId} commentId={comment.id} priority={comment.priority} canEdit={permissions.triage} /></dd>
                    <ThreadPullRequests projectId={projectId} comment={comment} />
                </dl>

                <VerificationControl projectId={projectId} userId={userId} comment={comment}
                    formOpen={verifying} onFormOpenChange={setVerifying} returnFocus={statusTrigger} />

                {/* The messages, one under the other like a chat */}
                <ol className="m-0 flex list-none flex-col gap-3 border-t p-0 pt-4">
                    <li>
                        <Message author={comment.deleted ? 'Deleted' : author} agent={!comment.deleted && <MessageAgent author={comment.author} />} avatarName={comment.author.name} avatarUrl={comment.author.avatarUrl} createdAt={comment.createdAt}
                            meta={<CommentDevice device={comment.device} context={comment.reproduction} />}>
                            <KindLabel kind={comment.kind} feedbackType={comment.feedbackType} />
                            {comment.deleted
                                ? <p className="m-0 text-sm text-muted-foreground">Comment deleted</p>
                                : editing
                                    ? <MessageEditor label="Edit comment" text={comment.text} error={editError} pending={pending}
                                        onCancel={closeEdit} onSave={text => saveEdit(text)} />
                                    : <MessageText text={comment.displayText} mentions={comment.displayMentions} edited={comment.edited} />}
                            {comment.screenshot && (
                                <Dialog>
                                    <DialogTrigger render={<Button variant="ghost" className="mt-1 h-auto max-w-full self-start p-0" aria-label="Screenshot of the commented part of the page" />}>
                                        <img src={comment.screenshot.url} width={comment.screenshot.width} height={comment.screenshot.height}
                                            alt="Screenshot of the commented part of the page" loading="lazy"
                                            className="block h-auto max-h-56 w-auto max-w-full rounded-lg border object-contain" />
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-4xl" aria-describedby={undefined}>
                                        <DialogHeader><DialogTitle>Screenshot</DialogTitle></DialogHeader>
                                        <img src={comment.screenshot.url} width={comment.screenshot.width} height={comment.screenshot.height}
                                            alt="Expanded screenshot" className="max-h-[70dvh] w-full object-contain" />
                                    </DialogContent>
                                </Dialog>
                            )}
                        </Message>
                    </li>
                    {comment.replies.map(item => <li key={item.id}>{reply(item)}</li>)}
                </ol>

                {/* Reply's icon lines up with the message text: past the 24px avatar and its 10px gap, less the button's 6px padding */}
                {permissions.reply && (replying
                    ? <ReplyComposer projectId={projectId} userId={userId} userName={assignees.find(person => person.userId === userId)?.name} comment={comment} textareaRef={replyField} onClose={() => setReplying(false)} />
                    : <Button variant="ghost" size="sm" className="ml-7 self-start text-muted-foreground hover:text-foreground pointer-coarse:min-h-11" aria-keyshortcuts={replyShortcut} onClick={() => setReplying(true)}>
                        <ReplyIcon data-icon="inline-start" />Reply
                    </Button>)}

                {/* The issues it is linked to, quiet as in the toolbar */}
                {comment.integrationLinks?.length ? (
                    <div className="-ml-2 flex flex-wrap items-center gap-x-1 gap-y-1">
                        {comment.integrationLinks.map(link => (
                            <a key={link.provider} href={link.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex min-h-6 items-center px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground pointer-coarse:min-h-11">
                                Open in {integrationLabels[link.provider] ?? link.provider}
                            </a>
                        ))}
                    </div>
                ) : null}
            </div>

            {/* Activity is the card's footer, under its divider */}
            <ThreadActivity entries={comment.history} />

            <AlertDialog open={confirmingDelete || Boolean(confirmingReply)} onOpenChange={open => {
                if (!open) { setConfirmingDelete(false); setConfirmingReply(undefined); }
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmingReply ? 'Delete this reply?' : 'Delete this comment?'}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmingReply ? 'The reply is deleted for everyone. An empty thread is removed too.' : comment.replies.length
                                ? `The comment and its ${comment.replies.length} ${comment.replies.length === 1 ? 'reply are' : 'replies are'} deleted for everyone.`
                                : 'The comment is deleted for everyone.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                            const itemId = confirmingReply;
                            setConfirmingDelete(false);
                            setConfirmingReply(undefined);
                            run(() => itemId ? deleteCommentReplyAction(projectId, comment.id, itemId) : deleteCommentAction(projectId, comment.id), itemId ? 'Reply deleted.' : 'Comment deleted.');
                        }}>
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
