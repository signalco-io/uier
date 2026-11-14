'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { commentKindIcon, commentKindLabel, type FeedbackTypeSnapshot } from '@uier/toolbar/feedback-types';
import { localizedKindLabel } from './kindLabel';
import { FeedbackTypeIcon } from '../FeedbackTypeIcon';

import { PriorityControl } from './PriorityControl';
import { useCommitCommentsSearch } from './CommentsSearchNavigation';

import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
    ArchiveIcon,
    ArchiveRestoreIcon,
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
import { ThreadLabelsControl } from './ThreadLabelsControl';
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
import { savedReply, useCommentUpdate, type SentReply } from './CommentUpdates';
import { useReadWhenShown } from './useReadWhenShown';
import { VerificationControl } from './VerificationControl';
import { defaultStatusWorkflow, workflowStatusLabel } from '../../../lib/app/statusWorkflow';
import { StateBadge, StateMenu, type CommentStatus } from './CommentStatus';
import { useStatusChange, type ResolveExit } from './useStatusChange';
import { MessageImage } from './MessageImage';
import { MessageRecording } from './MessageRecording';
import { ReactionList, ReactionPicker } from './MessageReactions';
import { ReplyComposer } from './ReplyComposer';
import { preloadMessageEditor } from './MessageComposer';
import { ThreadActivity } from './ThreadActivity';
import { AssigneesControl } from './AssigneesControl';
import { MessageAgent } from './MessageAgent';
import { appCommentDrafts } from './replyDrafts';
import { MessageEditor } from './MessageEditor';
import type { MessageMention } from './MentionEditor';
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
    setCommentArchivedAction,
    setCommentWorkflowStatusAction,
} from './actions';

export type AssigneeOption = { userId: string; name: string; avatarUrl?: string };

export type { ResolveExit } from './useStatusChange';

/** Who sees a private thread (`canSeeComment`): the workspace admins and its author */
const privateHint = 'Only workspace admins and the author can see this thread. Other members and guests cannot.';

/**
 * The blue dot of a thread with activity the reader has not read (the toolbar's `UnreadDot`).
 * It is the Mark as read button; Mark as unread is in the More actions menu.
 * Marking read or unread doesn't make the line jump (uier #371): the dot fades and scales while its room opens or
 * closes (its 12 px and the line's 8 px gap), so the badges after it slide. Hidden, it is `inert` and out of the
 * accessibility tree. No motion on the first render or with reduced motion.
 */
function UnreadDot({ shown, disabled, onRead }: { shown: boolean; disabled: boolean; onRead: () => void }) {
    const { t } = useAppI18n();
    return (
        <span data-unread-shown={shown} aria-hidden={shown ? undefined : true} inert={!shown}
            className={cn('flex shrink-0 justify-center transition-[width,margin,opacity,scale] duration-150 ease-out motion-reduce:transition-none',
                // Leaving, it shrinks in place first and only then closes its room, so it scales down rather than sliding aside (uier #438)
                shown ? 'w-3 scale-100 opacity-100' : '-mr-2 w-0 scale-50 opacity-0 [transition-delay:150ms,150ms,0ms,0ms]')}>
            <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t("Unread. Mark as read")} disabled={disabled} onClick={onRead}
                        className="-mx-1.5 shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11" />}>
                    <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />
                </TooltipTrigger>
                <TooltipContent>{t("Mark as read")}</TooltipContent>
            </Tooltip>
        </span>
    );
}

/** The Private badge beside the number: no background, so it sits quietly there; the lock and the tooltip carry it */
export function PrivateBadge() {
    const { t } = useAppI18n();
    return (
        <Tooltip>
            <TooltipTrigger render={<Badge variant="ghost" tabIndex={0} className="cursor-default text-muted-foreground outline-none hover:bg-transparent dark:hover:bg-transparent" />}>
                <LockIcon aria-hidden="true" data-icon="inline-start" />
                {t("Private")}
                <span className="sr-only">. {t(privateHint)}</span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{t(privateHint)}</TooltipContent>
        </Tooltip>
    );
}

/** The Page detail: the environment's name, then the link that opens the review there (the address itself is in the link) */
export function PageDetail({ comment, reviewLink }: { comment: Pick<ProjectCommentView, 'source' | 'url' | 'path'>; reviewLink: string }) {
    const { t } = useAppI18n();
    const { source } = comment;
    const sourceText = source.available
        ? source.label !== source.origin ? source.label : undefined
        : t("{value0}{value1} · Original source unavailable", { value0: source.label, value1: source.origin && source.origin !== source.label ? ` · ${source.origin}` : '' });
    return <>
        <dt className={detailLabelClass}>{t("Page")}</dt>
        <dd className={`${detailValueClass} gap-x-2`}>
            {sourceText && <span className="min-w-0 truncate text-xs text-muted-foreground">{sourceText}</span>}
            {source.available ? (
                <a href={reviewLink} target="_blank" rel="noopener"
                    className="-mx-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 text-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11">
                    <span className="sr-only">{t("Open on ")}</span>
                    <span className="truncate font-mono text-xs">{comment.url.replace(/^https?:\/\//, '')}</span>
                    <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                </a>
            ) : <span className="truncate font-mono text-xs">{comment.path}</span>}
        </dd>
    </>;
}

/**
 * Who the comment is assigned to: their avatar at 20px, smaller than the messages' so it sits in the
 * line beside the name, or the same avatar empty with a dashed outline while unassigned (as a pending
 * invitation's). Not `size="sm"`: its `data-[size=sm]:size-6` would win over `size-5`.
 */


/** A thread detail's label and value: one row height for text and controls alike (`h-7` ghost controls fit) */
export const detailLabelClass = 'flex h-8 items-center text-muted-foreground pointer-coarse:h-11';
export const detailValueClass = 'm-0 flex min-h-8 min-w-0 flex-wrap items-center pointer-coarse:min-h-11';

/** "Feedback", "Bug report" or "Suggested rewrite" above the first message, as in the toolbar */
export function KindLabel({ kind, feedbackType }: { kind: DbCommentKind; feedbackType?: FeedbackTypeSnapshot }) {
    const { t } = useAppI18n();
    if (kind === 'comment')
        return null;
    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-secondary-foreground">
            {kind === 'rewrite' ? <ReplaceIcon aria-hidden="true" className="size-3.5" /> : <FeedbackTypeIcon icon={commentKindIcon(kind, feedbackType)} className="size-3.5" />}
            {localizedKindLabel(kind, feedbackType, t)}
        </span>
    );
}

/** One message of the thread: the avatar makes the column, as in the toolbar's thread */
export function Message({ author, agent, avatarName, avatarUrl, createdAt, status, meta, actions, children }: {
    /** As shown: "You" for your own messages */
    author: string;
    /** "via Claude": the AI agent that wrote it for the author */
    agent?: ReactNode;
    /** The person's name, for the avatar's initial ("You" would make every own avatar a Y) */
    avatarName: string;
    /** Their profile picture, when they have one */
    avatarUrl?: string;
    createdAt?: string;
    /** Right of the time: "Sending..." while a reply is not saved yet (uier #377) */
    status?: ReactNode;
    /** After the time: the screen and browser the comment was left from */
    meta?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        // The avatar is centred on the header row, however tall its actions make it (44px on touch; uier #281)
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1">
            <Avatar size="sm" aria-hidden="true" className="self-center">
                {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
                <AvatarFallback className="font-semibold text-foreground">{initials(avatarName)}</AvatarFallback>
            </Avatar>
            <div className="flex min-h-7 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                    {/* Trimmed to the cap height, so the name and the smaller time centre on the avatar alike (uier #378) */}
                    <span className="truncate font-medium [text-box:trim-both_cap_alphabetic]">{author}</span>
                    {agent}
                    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums [text-box:trim-both_cap_alphabetic]"><RelativeTime value={createdAt} /></span>
                    {status}
                    {meta}
                </div>
                {actions}
            </div>
            <div className="col-start-2 flex min-w-0 flex-col gap-1">
                {children}
            </div>
        </div>
    );
}

/** The text of a message with its Markdown, "(edited)" after it as in the toolbar */
export function MessageText({ text, mentions, edited }: { text: string; mentions?: MessageMentionRange[]; edited: boolean }) {
    const { t } = useAppI18n();
    return <MessageMarkdown text={text} mentions={mentions} suffix={edited && <span className="font-normal text-muted-foreground">{t(" (edited)")}</span>} />;
}

/**
 * A project comment in the app's list and board, laid out like the toolbar's thread: status, number,
 * who it is assigned to and actions (following the thread among them) on one row, then the messages,
 * the linked issues, and the page it was left on at the bottom. It is the open thread: once it has been
 * on screen for a moment it is marked read (`useReadWhenShown`), except after Mark as unread.
 */
export function CommentCard({ projectId, comment, reviewLink, assignees, userId, onMove, onBack, onReadWhenShown, startVerifying = false, startVerifyingStatusId, className }: {
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
    startVerifyingStatusId?: string;
    className?: string;
}) {
    const { t } = useAppI18n();
    const router = useRouter();
    const updateComment = useCommentUpdate();
    const drafts = useMemo(() => appCommentDrafts(projectId, userId, comment.id), [projectId, userId, comment.id]);
    const [replying, setReplying] = useState(false);
    // Replies sent from here stay shown until the refreshed thread has them, as the optimistic one ends with the send
    // (uier #377). The saved reply keeps the pending one's list key, so it replaces it in place without a remount.
    const [sent, setSent] = useState<(SentReply & { savedId?: string; confirmedSequence?: number })[]>([]);
    const { replies, newlySaved } = useMemo(() => {
        const keys = new Map<string, string>();
        const held: ProjectCommentMessage[] = [];
        const newlySaved = new Map<SentReply, string>();
        for (const entry of sent) {
            // Each saved reply answers one sent reply, so two sends of the same words stay two
            const savedId = entry.savedId ?? savedReply(comment.replies.filter(item => !keys.has(item.id)), entry)?.id;
            if (savedId) keys.set(savedId, entry.reply.id);
            // A receipt replay can already be in previousReplyIds after reload. Once the
            // snapshot covers the confirmed write, it needs no extra pending message.
            else if (!(entry.confirmedSequence !== undefined && (comment.activity?.sequence ?? 0) >= entry.confirmedSequence)
                && !comment.replies.some(item => item.id === entry.reply.id)) held.push(entry.reply);
            if (savedId && !entry.savedId) newlySaved.set(entry, savedId);
        }
        return { replies: [...comment.replies, ...held].map(item => ({ item, key: keys.get(item.id) ?? item.id })), newlySaved };
    }, [comment.replies, comment.activity?.sequence, sent]);
    useEffect(() => {
        // Remember which saved reply each one became, so a later delete or edit of it cannot bring the pending one back
        if (newlySaved.size) setSent(current => current.map(entry => newlySaved.has(entry) ? { ...entry, savedId: newlySaved.get(entry) } : entry));
    }, [newlySaved]);
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
    // Restore only after hydration, once per thread/account scope. Refreshed props must never reset an open composer.
    const restoreComposers = useEffectEvent(() => {
        setEditing(permissions.edit && typeof drafts.details('edit')?.originalText === 'string');
        const item = comment.replies.find(item => item.editable && typeof drafts.details(`edit-reply:${item.id}`)?.originalText === 'string');
        if (item) {
            const saved = drafts.details(`edit-reply:${item.id}`)!;
            setEditingReply({ id: item.id, expectedText: saved.originalText!, text: saved.text, mentions: saved.mentions ?? [] });
        }
    });
    useEffect(() => { restoreComposers(); }, [drafts]);
    const beginEdit = (key: string, text: string, mentions: MessageMention[] = []) => {
        if (typeof drafts.details(key)?.originalText === 'string') return;
        drafts.set(key, text);
        drafts.setDetails(key, { originalText: text, mentions });
    };
    const finishSavedEdit = (key: string, text: string, mentions: MessageMention[] = []) => {
        const current = drafts.details(key);
        if (!current) return true;
        if (current.text === text && JSON.stringify(current.mentions ?? []) === JSON.stringify(mentions)) {
            drafts.delete(key);
            return true;
        }
        // Someone continued typing while the save was pending, possibly in a remounted editor.
        drafts.setDetails(key, { originalText: text.trim() });
        return false;
    };
    // The reply whose More actions takes the focus back once its edit closes and nothing is pending
    const replyActionsFocus = useRef<string>(undefined);
    // The Request verification form, opened from the status menu
    const [verifying, setVerifying] = useState(startVerifying);
    const [verificationStatusId, setVerificationStatusId] = useState(startVerifyingStatusId);
    const statusTrigger = useRef<HTMLButtonElement>(null);
    const { permissions, source } = comment;
    // The message editor is its own chunk: it loads while the page is idle, so Reply and Edit open with it
    useEffect(() => {
        if (!permissions.reply && !permissions.edit) return;
        if (typeof window.requestIdleCallback === 'function') {
            const id = window.requestIdleCallback(preloadMessageEditor);
            return () => window.cancelIdleCallback(id);
        }
        const timeout = setTimeout(preloadMessageEditor, 500);
        return () => clearTimeout(timeout);
    }, [permissions.reply, permissions.edit]);
    const statusChange = useStatusChange(projectId, comment, {
        onMove,
        onVerify: statusId => { setVerificationStatusId(statusId); setVerifying(true); }
    });
    const changeStatus = (next: CommentStatus, statusId?: string) => {
        if (next !== 'ready') setVerifying(false);
        statusChange.change(next, statusId);
    };
    const author = comment.author.isMe ? t("You") : comment.author.name;
    const label = comment.deleted ? t("Deleted comment") : t("Comment by {value0}", { value0: comment.author.isMe ? t("you") : comment.author.name });
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
    // The reply box itself: an open message editor in the same card is another text box
    const replyField = useRef<{ focus: () => void }>(null);
    // Escape closes the empty reply box: the focus goes back to Reply, which takes its place
    const replyButton = useRef<HTMLButtonElement>(null);
    const focusReplyButton = useRef(false);
    useEffect(() => {
        if (replying || !focusReplyButton.current) return;
        focusReplyButton.current = false;
        replyButton.current?.focus();
    }, [replying]);
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


    const run = (action: () => Promise<ActionState>, success?: string, patch?: Partial<ProjectCommentView>, done?: () => void) => startTransition(async () => {
        const confirm = patch ? updateComment({ id: comment.id, patch }) : undefined;
        let result: ActionState;
        try { result = await action(); }
        catch { toast.error(t("Could not save the change. Try again.")); return; }
        if (result && !result.ok) {
            toast.error(result.error);
            return;
        }
        // Cursor reversals and following need their own receipt version; retain only monotonic
        // reads and writes carrying the comment's saved activity sequence.
        if (result?.ok && patch) confirm?.(result, { retain: !patch.activity?.unread && !('following' in patch) });
        if (success)
            toast.success(success);
        done?.();
        // The server action already revalidates this page and returns its fresh snapshot.
    });

    const filterAuthor = (itemId?: string) => startTransition(async () => {
        commitSearch();
        const result = await filterCommentAuthorAction(projectId, comment.id, itemId);
        if (!result?.ok) {
            toast.error(result?.error ?? t("Could not filter by this author."));
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
            toast.success(t("Link copied. It opens the page at this comment."));
        } catch {
            toast.error(t("Couldn't copy the link."));
        }
    };

    // The first message is edited in place like a reply. Choosing Edit leaves the focus in the editor (the menu
    // does not take it back); the thread's More actions takes it once the edit closes and nothing is pending.
    const threadActions = useRef<HTMLButtonElement>(null);
    const editChosen = useRef(false);
    const threadActionsFocus = useRef(false);
    const closeEdit = () => {
        drafts.delete('edit');
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
        try { result = await drafts.run('edit', () => editCommentAction(projectId, comment.id, text)); }
        catch { result = { ok: false, error: t("Could not save the change. Try again.") }; }
        if (result && !result.ok) {
            setEditError(result.error);
            return;
        }
        if (finishSavedEdit('edit', text)) closeEdit();
    });

    useEffect(() => {
        const id = replyActionsFocus.current;
        if (!id || pending || editingReply) return;
        replyActionsFocus.current = undefined;
        cardRef.current?.querySelector<HTMLElement>(`[data-reply-actions="${CSS.escape(id)}"]`)?.focus();
    }, [pending, editingReply]);

    const closeReplyEdit = (id: string, discard = true) => {
        if (discard) drafts.delete(`edit-reply:${id}`);
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
        closeReplyEdit(item.id, unchanged);
        if (unchanged) return;
        startTransition(async () => {
            updateComment({ id: comment.id, patch: { replies: comment.replies.map(current => current.id === item.id ? {
                ...current, text: sent, mentions: sentMentions.length ? sentMentions.map(({ start, end }) => ({ start, end })) : undefined,
                edited: true, editable: { text: sent, mentions: sentMentions }
            } : current) } });
            let result: ActionState;
            try { result = await drafts.run(`edit-reply:${item.id}`, () => editCommentReplyAction(projectId, comment.id, item.id, sent, expectedText, sentMentions)); }
            catch { result = { ok: false, error: t("Could not save the change. Try again.") }; }
            // The tried text stays in the field with the reason, as the toolbar keeps it
            if (result && !result.ok) {
                if (drafts.details(`edit-reply:${item.id}`))
                    setEditingReply({ id: item.id, expectedText, text, mentions, error: result.error });
            } else if (!finishSavedEdit(`edit-reply:${item.id}`, text, mentions)) {
                const newer = drafts.details(`edit-reply:${item.id}`)!;
                setEditingReply({ id: item.id, expectedText: sent, text: newer.text, mentions: newer.mentions ?? [] });
            }
        });
    };

    const reply = (item: ProjectCommentMessage) => {
        const name = item.author.isMe ? t("You") : item.author.name;
        const edit = editingReply?.id === item.id && item.editable ? editingReply : undefined;
        const editable = item.editable;
        const target = !item.deleted && !item.pending ? { projectId, commentId: comment.id, itemId: item.id, reactions: item.reactions } : undefined;
        return (
            <Message author={name} agent={!item.deleted && <MessageAgent author={item.author} />} avatarName={item.author.name} avatarUrl={item.author.avatarUrl} createdAt={item.createdAt}
                status={item.pending && <span role="status" className="shrink-0 text-xs whitespace-nowrap text-muted-foreground [text-box:trim-both_cap_alphabetic]">{t("Sending...")}</span>}
                actions={!item.deleted && !edit && (<div className="flex shrink-0 items-center gap-0.5">
                    {target && permissions.react && <ReactionPicker target={target} disabled={pending} />}
                    {(item.canDelete || item.canFilterAuthor || editable) && (
                    <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" disabled={pending} className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                                data-reply-actions={item.id} aria-label={t("More actions for reply by {value0}", { value0: item.author.isMe ? t("you") : item.author.name })} />}>
                            <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-auto min-w-48">
                            <DropdownMenuGroup>
                                {editable && (
                                    <DropdownMenuItem onClick={() => {
                                        beginEdit(`edit-reply:${item.id}`, editable.text, editable.mentions);
                                        setEditingReply({ id: item.id, expectedText: drafts.details(`edit-reply:${item.id}`)!.originalText!, text: editable.text, mentions: editable.mentions });
                                    }}>
                                        <PencilIcon />
                                        {t("Edit")}
                                    </DropdownMenuItem>
                                )}
                                {item.canFilterAuthor && (
                                    <DropdownMenuItem onClick={() => filterAuthor(item.id)}>
                                        <UserIcon />
                                        {t("More from this author")}
                                    </DropdownMenuItem>
                                )}
                                {item.canDelete && (
                                    <DropdownMenuItem variant="destructive" onClick={() => setConfirmingReply(item.id)}>
                                        <Trash2Icon />
                                        {t("Delete reply")}
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    )}
                </div>)}>
                {item.deleted
                    ? <p className="m-0 text-sm text-muted-foreground">{t("Reply deleted")}</p>
                    : edit
                        ? <MessageEditor drafts={drafts} draftKey={`edit-reply:${item.id}`} mentionsIn={{ projectId, commentId: comment.id }} label={t("Edit reply")}
                            text={edit.text} mentions={edit.mentions} error={edit.error}
                            onCancel={() => closeReplyEdit(item.id)} onSave={(text, mentions) => saveReply(item, edit.expectedText, text, mentions)} />
                        : <MessageText text={item.text} mentions={item.mentions} edited={item.edited} />}
                {!item.deleted && item.screenshot && <MessageImage image={item.screenshot} reply sending={item.pending} />}
                {!item.deleted && !item.pending && item.recording && <MessageRecording recording={item.recording} projectId={projectId} commentId={comment.id} itemId={item.id} />}
                {target && !edit && <ReactionList target={target} canReact={Boolean(permissions.react)} />}
            </Message>
        );
    };

    const { anchor } = comment;
    // The first message's reactions (older snapshots have no message id: no reactions until the next refresh)
    const firstTarget = !comment.deleted && comment.messageId ? { projectId, commentId: comment.id, itemId: comment.messageId, reactions: comment.reactions } : undefined;
    return (
        <Card ref={cardRef} role="article" aria-label={label} className={cn('@container/comment gap-0 py-0', className)}>
            <div className="flex flex-col gap-4 px-4 py-3">
                {/* Status, public id and unread on the left; Copy and More actions on the right, on one line at any width */}
                <div className="flex items-center gap-2">
                    {onBack && (
                        <Button variant="ghost" size="icon-sm" aria-label={t("Back to comments")} onClick={onBack}
                            className="-ml-2 shrink-0 @3xl/comments:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                            <ArrowLeftIcon />
                        </Button>
                    )}
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {Object.values(statusChange.allowed).some(Boolean)
                            ? <StateMenu comment={comment} status={statusChange.status} allowed={statusChange.allowed} disabled={pending || statusChange.pending} onChange={changeStatus} triggerRef={statusTrigger} keyShortcut={statusShortcut} />
                            : <StateBadge comment={comment} status={statusChange.status} />}
                        {comment.number !== undefined && (
                            <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                <span className="sr-only">{t("Comment ")}</span>#{comment.number}
                            </span>
                        )}
                        {/* Kept while the thread can be unread, so marking it read or unread animates (uier #371) */}
                        {(unread || canMarkUnread) && (
                            <UnreadDot shown={unread} disabled={pending || !unread}
                                onRead={() => run(() => markCommentReadAction(projectId, comment.id, comment.activity!.sequence), undefined,
                                    { activity: { ...comment.activity!, readSequence: comment.activity!.sequence, unread: false } })} />
                        )}
                        {comment.archivedAt && <Badge variant="outline" className="text-muted-foreground">{t("Archived")}</Badge>}
                        {comment.private && <PrivateBadge />}
                    </div>
                    <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
                        <CopyMenu copyIssue={copyIssue} canCopyLink={source.available} onCopyLink={copyLink} />
                        <DropdownMenu>
                            <Tooltip>
                                <TooltipTrigger render={<DropdownMenuTrigger render={<Button ref={threadActions} variant="ghost" size="icon-sm" disabled={pending} aria-label={t("More actions for the {value0}", { value0: label.toLowerCase() })}
                                    className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11" />} />}>
                                    {pending ? <Spinner /> : <MoreHorizontalIcon />}
                                </TooltipTrigger>
                                <TooltipContent>{t("More actions")}</TooltipContent>
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
                                            comment.following ? t("You no longer follow this thread.") : t("You follow this thread now."), { following: !comment.following })}>
                                        {comment.following ? <BellOffIcon /> : <BellIcon />}
                                        {comment.following ? t("Unfollow thread") : t("Follow thread")}
                                    </DropdownMenuItem>
                                    {canMarkUnread && (
                                        <DropdownMenuItem onClick={() => {
                                            setKeptUnread(true);
                                            run(() => markCommentUnreadAction(projectId, comment.id), undefined,
                                                { activity: { ...comment.activity!, readSequence: Math.max(0, comment.activity!.lastOtherSequence - 1), unread: true } });
                                        }}>
                                            <MailIcon />
                                            {t("Mark as unread")}
                                        </DropdownMenuItem>
                                    )}
                                    {permissions.resolve && <>
                                        <DropdownMenuItem onClick={() => run(() => setCommentArchivedAction(projectId, comment.id, !comment.archivedAt), undefined,
                                            { archivedAt: comment.archivedAt ? undefined : new Date().toISOString(), archiveStatusId: comment.archivedAt ? undefined : (comment.workflow ?? defaultStatusWorkflow).archiveStatusId })}>
                                            {comment.archivedAt ? <ArchiveRestoreIcon /> : <ArchiveIcon />}{comment.archivedAt ? t('Restore comment') : t('Archive comment')}
                                        </DropdownMenuItem>
                                        {(comment.workflow ?? defaultStatusWorkflow).statuses.filter(status => status.category === 'archive').map(status => (
                                            ((comment.workflow ?? defaultStatusWorkflow).statuses.filter(option => option.category === 'archive').length > 1) &&
                                            <DropdownMenuItem key={status.id} title={status.description || undefined} disabled={Boolean(comment.archivedAt) && comment.archiveStatusId === status.id} onClick={() => run(
                                                () => setCommentWorkflowStatusAction(projectId, comment.id, status.id), undefined,
                                                { archivedAt: comment.archivedAt ?? new Date().toISOString(), archiveStatusId: status.id })}>
                                                <ArchiveIcon />{workflowStatusLabel(status, t)}
                                            </DropdownMenuItem>
                                        ))}
                                    </>}
                                    {permissions.edit && (
                                        <DropdownMenuItem
                                            onClick={() => {
                                                editChosen.current = true;
                                                setEditError(undefined);
                                                beginEdit('edit', comment.text);
                                                setEditing(true);
                                            }}>
                                            <PencilIcon />
                                            {t("Edit")}
                                        </DropdownMenuItem>
                                    )}
                                    {permissions.makePrivate && (
                                        <DropdownMenuItem
                                            onClick={() => run(
                                                () => setCommentPrivateAction(projectId, comment.id, !comment.private),
                                                comment.private ? t("Everyone with access sees this comment again.") : t("Only admins and the author see this comment now."))}>
                                            {comment.private ? <LockOpenIcon /> : <LockIcon />}
                                            {comment.private ? t("Make public") : t("Make private")}
                                        </DropdownMenuItem>
                                    )}
                                    {comment.canFilterAuthor && (
                                        <DropdownMenuItem onClick={() => filterAuthor()}>
                                            <UserIcon />
                                            {t("More from this author")}
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuGroup>
                                {permissions.delete && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
                                            <Trash2Icon />
                                            {t("Delete")}
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
                <ThreadTitle key={`${comment.id}-title`} projectId={projectId} commentId={comment.id} title={comment.title} byAi={comment.titleByAi} canRename={permissions.title} />
                <CopyIssueResult state={copyIssue} />

                {/* From the most abstract to the most detailed: the page (its environment, then the link that opens the review there), the
                    element or text, who has it, its priority, then its pull requests.
                    A properties list: every row is one control tall (44px on touch screens), labels and values centred on it,
                    and a ghost control pulled left by its padding so its text starts where plain text does. */}
                <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 text-sm" data-thread-details>
                    <PageDetail comment={comment} reviewLink={reviewLink} />
                    <dt className={detailLabelClass}>{t("On")}</dt>
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
                    <dt className={detailLabelClass}>{t("Assignees")}</dt>
                    <dd className={detailValueClass}>
                        <AssigneesControl projectId={projectId} comment={comment} userId={userId} options={assignees} trigger={assigneeTrigger} shortcut={assigneeShortcut} />
                    </dd>
                    <dt className={detailLabelClass}>{t("Priority")}</dt>
                    <dd className={detailValueClass}><PriorityControl projectId={projectId} commentId={comment.id} priority={comment.priority} canEdit={permissions.triage} /></dd>
                    <dt className={detailLabelClass}>{t('Labels')}</dt>
                    <dd className={detailValueClass}><ThreadLabelsControl projectId={projectId} commentId={comment.id} labels={comment.labels ?? []} available={comment.availableLabels ?? []} canEdit={permissions.triage} /></dd>
                    <ThreadPullRequests projectId={projectId} comment={comment} />
                </dl>

                <VerificationControl projectId={projectId} userId={userId} comment={comment}
                    statusId={verificationStatusId} formOpen={verifying} onFormOpenChange={setVerifying} returnFocus={statusTrigger} />

                {/* The messages, one under the other like a chat */}
                <ol className="m-0 flex list-none flex-col gap-3 border-t p-0 pt-4">
                    <li>
                        <Message author={comment.deleted ? t("Deleted") : author} agent={!comment.deleted && <MessageAgent author={comment.author} />} avatarName={comment.author.name} avatarUrl={comment.author.avatarUrl} createdAt={comment.createdAt}
                            meta={<CommentDevice device={comment.device} context={comment.reproduction} />}
                            actions={firstTarget && permissions.react && !editing && <ReactionPicker target={firstTarget} disabled={pending} />}>
                            <KindLabel kind={comment.kind} feedbackType={comment.feedbackType} />
                            {comment.deleted
                                ? <p className="m-0 text-sm text-muted-foreground">{t("Comment deleted")}</p>
                                : editing
                                    ? <MessageEditor drafts={drafts} draftKey="edit" label={t("Edit comment")} text={comment.text} error={editError} pending={pending}
                                        onCancel={closeEdit} onSave={text => saveEdit(text)} />
                                    : <MessageText text={comment.displayText} mentions={comment.displayMentions} edited={comment.edited} />}
                            {comment.screenshot && <MessageImage image={comment.screenshot} />}
                            {!comment.deleted && comment.recording && <MessageRecording recording={comment.recording} projectId={projectId} commentId={comment.id} />}
                            {firstTarget && !editing && <ReactionList target={firstTarget} canReact={Boolean(permissions.react)} />}
                        </Message>
                    </li>
                    {replies.map(({ item, key }) => <li key={key}>{reply(item)}</li>)}
                </ol>

                {/* Reply's icon lines up with the message text: past the 24px avatar and its 10px gap, less the button's 6px padding */}
                {permissions.reply && (replying
                    ? <ReplyComposer projectId={projectId} userId={userId} userName={assignees.find(person => person.userId === userId)?.name} comment={comment} fieldRef={replyField} onClose={() => { focusReplyButton.current = true; setReplying(false); }}
                        onSend={entry => {
                            setSent(current => [...current, entry]);
                            return confirmedSequence => setSent(current => confirmedSequence === undefined
                                ? current.filter(item => item.reply.id !== entry.reply.id)
                                : current.map(item => item.reply.id === entry.reply.id ? { ...item, confirmedSequence } : item));
                        }} />
                    : <Button ref={replyButton} variant="ghost" size="sm" className="ml-7 self-start text-muted-foreground hover:text-foreground pointer-coarse:min-h-11" aria-keyshortcuts={replyShortcut} onClick={() => setReplying(true)}>
                        <ReplyIcon data-icon="inline-start" />{t("Reply")}
                    </Button>)}

                {/* The issues it is linked to, quiet as in the toolbar */}
                {comment.integrationLinks?.length ? (
                    <div className="-ml-2 flex flex-wrap items-center gap-x-1 gap-y-1">
                        {comment.integrationLinks.map(link => (
                            <a key={link.provider} href={link.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex min-h-6 items-center px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground pointer-coarse:min-h-11">
                                {t("Open in ")}{integrationLabels[link.provider] ?? link.provider}
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
                        <AlertDialogTitle>{confirmingReply ? t("Delete this reply?") : t("Delete this comment?")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmingReply ? t("The reply is deleted for everyone. An empty thread is removed too.") : comment.replies.length
                                ? comment.replies.length === 1 ? t("The comment and its reply are deleted for everyone.") : t("The comment and its {count} replies are deleted for everyone.", { count: comment.replies.length })
                                : t("The comment is deleted for everyone.")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                            const itemId = confirmingReply;
                            setConfirmingDelete(false);
                            setConfirmingReply(undefined);
                            run(() => itemId ? deleteCommentReplyAction(projectId, comment.id, itemId) : deleteCommentAction(projectId, comment.id), itemId ? t("Reply deleted.") : t("Comment deleted."),
                                // A deleted thread is gone from every list, My work's board too (it keeps threads changed there)
                                undefined, itemId ? undefined : () => startTransition(() => { updateComment({ id: comment.id, removed: true }); }));
                        }}>
                            {t("Delete")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
