'use client';

import { selectedWorkflowStatus, useWorkflowStatus, type WorkflowStatus } from '../hooks/useWorkflowStatus';

import { feedbackStage, feedbackStages, type FeedbackStage } from '../verification';
import { useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Row } from '@uier/ui-primitives/Row';
import { Stack } from '@uier/ui-primitives/Stack';
import { IconButton } from '@uier/ui-primitives/IconButton';
import { cx } from '@uier/ui-primitives/cx';
import { Check, Play } from '@uier/ui-icons';
import { Popper } from '@uier/ui-primitives/Popper';
import { Button } from '@uier/ui-primitives/Button';
import { newLocalId, useComments, useReadComment, useUnreadComment } from '../hooks/useComments';
import { commentPriority, type CommentPriority as CommentPriorityValue } from '../triage';
import { commentLink } from '../review';
import { toolbarConfig } from '../config';
import { useProjectViewer } from '../project/ProjectGate';
import { useReviewSessionCommand } from '../project/reviewSessions';
import { CommentsBootstrapperContext, useToolbarPortalContainer } from './CommentsBootstrapperContext';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { CommentItem, destructiveTextClassName, floatingShadowClassName } from './@types/Comments';
import { CopyIssueResult, CopyMenu, useCopyIssue } from './CopyIssue';
import { assignedText, CommentAssignee, CommentAssigneeOptions } from './CommentAssignment';
import { CommentThreadMenu, type FirstMessageActions } from './CommentThreadMenu';
import { IconTooltip } from './IconTooltip';
import { useThreadNotificationActions } from './ThreadNotifications';
import { useShortcutsEnabled } from '../shortcuts';
import { assignShortcutEvent } from '../threadShortcuts';
import { keepMovedFocus, toolbarSurface } from '../toolbarReview';
import { moveFocusInMenu } from '../focusKeys';
import { useMessages, type Messages } from '../i18n';

/** A status's name: the localized built-in names, a custom status's own */
export function statusLabel(status: WorkflowStatus, t: Messages) {
    const builtins = { open: 'Open', 'in-progress': 'In progress', ready: 'Ready to verify', done: 'Done', archive: 'Archive' };
    return status.id === status.category && status.label === builtins[status.category]
        ? status.category === 'archive' ? t.inbox.filters.archived : t.status[status.category] : status.label;
}

/** Each status's dot (BRAND.md, "Status"): Open an ink ring (outlined), In progress sky, Ready to verify violet, Done green. The app's `StateDot`. */
export const stageDotColors: Record<FeedbackStage, string> = {
    open: 'border border-foreground',
    'in-progress': 'bg-[hsl(var(--brand-in-progress))]',
    ready: 'bg-[hsl(var(--brand-ready))]',
    done: 'bg-[hsl(var(--brand-success))]'
};

export function StatusDot({ stage }: { stage: FeedbackStage }) {
    return <span aria-hidden="true" data-status-dot={stage} className={cx('size-1.5 shrink-0 rounded-full', stageDotColors[stage])} />;
}

/**
 * A faint halo in each status's colour behind its dot (Open's ink at a lower strength), on the thread's status chip
 * (uier #462): the app's `GlowingStateDot`, kept as subtle as the board column headers' (uier #399). Decorative; it
 * takes no room.
 */
const stageGlowColors: Record<FeedbackStage, string> = {
    open: 'bg-foreground/10',
    'in-progress': 'bg-[hsl(var(--brand-in-progress)/0.25)]',
    ready: 'bg-[hsl(var(--brand-ready)/0.25)]',
    done: 'bg-[hsl(var(--brand-success)/0.25)]'
};

export function GlowingStatusDot({ stage }: { stage: FeedbackStage }) {
    return (
        <span className="relative flex shrink-0 items-center justify-center">
            <span aria-hidden="true" data-status-glow={stage} className={cx('pointer-events-none absolute size-3 rounded-full blur-[2px]', stageGlowColors[stage])} />
            <span className="relative flex"><StatusDot stage={stage} /></span>
        </span>
    );
}

/** "Open", "In progress", "Ready to verify" or "Done", with the status dot in its colour and its glow. The app's `StateBadge`. */
export function CommentStatusBadge({ stage, label }: { stage: FeedbackStage; label?: string }) {
    const t = useMessages();
    return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">
            <GlowingStatusDot stage={stage} />
            <span className="sr-only">{t.thread.statusPrefix}</span>
            {label ?? t.status[stage]}
        </span>
    );
}

/**
 * The status badge as a menu with every status, like the app's `StateMenu`: each is enabled when the
 * person may move the thread there (`allowed`). Ready to verify opens the Request verification form
 * (again while a check is pending); from Ready to verify, Done says Done without verification. S moves
 * the focus to the badge (`data-uier-status`); Enter or Space opens it, the current status focused. The badge has no
 * chevron (uier #501): its outline and name say it is a control.
 */
function CommentStatusMenu({ stage, allowed, pending, shortcut, onChange, statuses, selectedId, verificationEnabled }: {
    stage: FeedbackStage;
    allowed: Record<FeedbackStage, boolean>;
    pending: boolean;
    shortcut: boolean;
    verificationEnabled: boolean;
    statuses?: WorkflowStatus[]; selectedId?: string;
    onChange: (stage: FeedbackStage, statusId?: string) => void;
}) {
    const container = useToolbarPortalContainer();
    const t = useMessages();
    const [open, setOpen] = useState(false);
    const currentRef = useRef<HTMLButtonElement>(null);
    // Ready to verify waits for the menu to close: its form then takes the focus
    const requesting = useRef<string | false>(false);
    const options = feedbackStages.filter(category => verificationEnabled || category !== 'ready').flatMap(category => {
        const matches = statuses?.filter((status): status is WorkflowStatus & { category: FeedbackStage } => status.category === category);
        return matches ?? [{ id: category, category, label: t.status[category], description: '' }];
    });
    const localizedOptions = options.map(option => ({ ...option, label: statusLabel(option, t) }));
    const selected = localizedOptions.find(option => option.id === selectedId) ?? localizedOptions.find(option => option.category === stage);
    const label = selected?.label ?? t.status[stage];
    const choose = (option: typeof options[number]) => {
        setOpen(false);
        if (option.category === 'ready' && (stage !== 'ready' || option.id === selected?.id)) requesting.current = option.id;
        else onChange(option.category, statuses ? option.id : undefined);
    };
    // Radix props passed through the Popper to the popover content
    const contentProps = {
        onOpenAutoFocus: (event: Event) => {
            event.preventDefault();
            currentRef.current?.focus();
        },
        onCloseAutoFocus: (event: Event) => {
            if (!requesting.current) {
                keepMovedFocus(event);
                return;
            }
            const statusId = requesting.current;
            requesting.current = false;
            event.preventDefault();
            onChange('ready', statusId || undefined);
        }
    };
    return (
        <Popper
            container={container}
            open={open}
            onOpenChange={setOpen}
            align="start"
            aria-label={t.thread.statusLabel}
            // Like a menu: ↑ and ↓ move between its statuses. Escape closes only the menu (React
            // events bubble out of the portal to the thread, whose inbox would close too)
            onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); else moveFocusInMenu(event); }}
            {...toolbarSurface('uier-thread-status-menu', cx('z-[70] w-64 max-h-[60vh] overflow-y-auto max-w-[calc(100vw-1rem)] rounded-xl p-1', floatingShadowClassName))}
            trigger={(
                <Button
                    variant="outlined"
                    size="xs"
                    className="h-6 shrink-0 gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium pointer-coarse:h-8 pointer-coarse:px-3"
                    aria-label={t.thread.changeStatus(label)}
                    aria-keyshortcuts={shortcut ? 'S' : undefined}
                    data-uier-status=""
                    data-uier-thread-control="">
                    <GlowingStatusDot stage={stage} />
                    <span className="sr-only">{t.thread.statusPrefix}</span>
                    {label}
                </Button>
            )}
            {...contentProps}>
            <Stack role="group" aria-label={t.thread.setStatus}>
                {localizedOptions.map((option, index) => {
                    const current = option.id === selected?.id;
                    const enabled = allowed[option.category];
                    const categoryStart = index === 0 || options[index - 1]?.category !== option.category;
                    return <Stack key={option.id}>
                        {categoryStart && <span className="px-2 py-1 text-xs text-muted-foreground">{t.status[option.category]}</span>}
                        <Button ref={current ? currentRef : undefined} variant="plain" size="sm" fullWidth className="justify-start"
                            aria-pressed={current} disabled={pending || (!current && !enabled)} title={option.description || undefined}
                            startDecorator={<StatusDot stage={option.category} />}
                            endDecorator={current ? <Check size={14} className="ml-auto" /> : undefined}
                            onClick={() => enabled && (!current || option.category === 'ready') ? choose(option) : setOpen(false)}>
                            <span className="text-left"><span className="block">{option.id === 'done' && option.label === t.status.done && stage === 'ready' ? t.thread.doneWithoutVerification : option.label}</span>{option.description && <span className="block text-xs font-normal text-muted-foreground">{option.description}</span>}</span>
                        </Button>
                    </Stack>;
                })}
            </Stack>
        </Popper>
    );
}

/**
 * The blue dot of a thread with activity the reviewer has not read (blue: the unread count's colour).
 * It is the Mark as read button; Mark as unread is in the thread's options.
 */
export function UnreadDot({ className, disabled, onRead }: { className?: string; disabled?: boolean; onRead: () => void }) {
    const t = useMessages();
    return (
        <IconTooltip label={t.thread.markAsRead}>
            <IconButton
                size="xs"
                variant="plain"
                className={cx('-mx-1.5 size-6 shrink-0', className)}
                aria-label={t.thread.unreadMarkAsRead}
                data-uier-thread-control=""
                disabled={disabled}
                onClick={onRead}>
                <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />
            </IconButton>
        </IconTooltip>
    );
}

/** Where the thread came from: "Production · https://example.com", as in the app's comment card */
export function sourceText(source: NonNullable<CommentItem['source']>, t: Messages) {
    return `${source.label}${source.origin && source.origin !== source.label ? ` · ${source.origin}` : ''}${!source.available ? ` · ${t.thread.sourceUnavailable}` : ''}`;
}

/** The thread's quiet icon actions; the tooltip names them, so does the label for assistive technologies */
export const threadActionClassName = 'size-7 text-muted-foreground hover:text-foreground';
/** Copy and Thread options in the header's one line, the size of Add reaction: smaller, so the first message's author fits beside the status (uier #470) */
export const compactThreadActionClassName = 'size-6 text-muted-foreground hover:text-foreground';

/** A priority other than Normal, beside the status (Normal says nothing) */
function PriorityBadge({ comment }: { comment: CommentItem }) {
    const t = useMessages();
    const priority = commentPriority(comment.priority);
    if (priority === 'normal') return null;
    return (
        <span className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs text-foreground">
            <span className="sr-only">{t.thread.priorityPrefix}</span>{t.priority[priority]}
        </span>
    );
}

/**
 * The top of a thread (popover and inbox), on one line: its status, public id (`#12`), unread dot (it
 * marks the thread read), a priority other than Normal and the first message's author and time (the first
 * message is the thread, uier #470), then the first message's device marks and the actions: the assignee's avatar, Add reaction
 * to the first message, Copy (the issue or the link) and Thread options with the first message's options
 * and the triage and email controls each person may use (edit, reattach, assign, priority, Request
 * verification, follow, mute, Mark as unread, delete). The status is a menu (Open, In progress, Ready to
 * verify, Done) for those who may change it, else a badge. The people to assign open under the line.
 * `onMarkedUnread`: the reviewer asked for the thread to stay unread (no automatic read while open).
 */
export function CommentThreadHeader({ comment, message, onMarkedUnread, onRequestVerification, optionsRef }: {
    comment: CommentItem;
    /** The first message's part of the line: its author line, Add reaction, Attach to comment and its options for Thread options */
    message?: { author?: ReactNode; device?: ReactNode; reaction?: ReactNode; attach?: ReactNode; actions?: FirstMessageActions };
    onMarkedUnread?: () => void;
    /** Thread options' Request verification and the status menu's Ready to verify: the form opens in the thread */
    onRequestVerification?: (statusId?: string) => void;
    /** Thread options' button, where focus returns from the forms it opens */
    optionsRef?: RefObject<HTMLButtonElement | null>;
}) {
    const { review } = useContext(CommentsBootstrapperContext);
    const { isMember, reviewSession, reviewSessionsAvailable } = useProjectViewer();
    const t = useMessages();
    const { resolve, progress, archive, prioritize, verification: verificationMutation } = useComments();
    const read = useReadComment();
    const unreadMutation = useUnreadComment();
    const announce = useAnnounce();
    const reviewCommand = useReviewSessionCommand();
    const reviewInfo = comment.reviewSession;
    const canResumeReview = reviewSessionsAvailable && !reviewSession && reviewInfo?.canResume;
    const [uncopiedLink, setUncopiedLink] = useState<string>();
    const stage = feedbackStage(comment);
    const custom = useWorkflowStatus();
    const selectedStatus = selectedWorkflowStatus(comment, stage, custom.workflow.data);
    // Only the author changes the status (the API enforces it too); in a project, every member can (the API's `permissions`)
    const canResolve = !comment.pending && (comment.permissions?.resolve ?? comment.isMine);
    const unread = Boolean(comment.activity?.unread);
    // Only someone else's activity can be unread
    const canMarkUnread = !unread && !comment.pending && Boolean(comment.activity?.lastOtherSequence);
    const issue = useCopyIssue(comment.id);
    // The people to assign: from Thread options, or with A (`assignShortcutEvent`), which also focuses the first
    const [assigning, setAssigning] = useState<false | 'menu' | 'key'>(false);
    const headerRef = useRef<HTMLDivElement>(null);
    const canAssign = Boolean(comment.permissions?.assign) && !comment.pending;
    useEffect(() => {
        const header = headerRef.current;
        if (!header || !canAssign) return;
        const onAssign = (event: Event) => {
            event.preventDefault();
            setAssigning('key');
        };
        header.addEventListener(assignShortcutEvent, onAssign);
        return () => header.removeEventListener(assignShortcutEvent, onAssign);
    }, [canAssign]);
    const shortcuts = useShortcutsEnabled();
    const notifications = useThreadNotificationActions(comment);
    // A failed priority change keeps its identity until the intended value changes
    const priorityAttempt = useRef<{ priority: string; key: string } | null>(null);
    // A failed canceled check keeps its identity until the intended status changes
    const cancelAttempt = useRef<{ status: string; key: string } | null>(null);
    const verification = comment.verificationPermissions;

    // Where the person may move the thread, as the app's `allowedStatuses`: Open, In progress and Done
    // with the resolve permission; from Ready to verify, Open and In progress cancel the check (the
    // requester or an admin); Ready to verify with the request permission
    const leave = stage === 'ready' ? Boolean(verification?.cancel) && !comment.pending : canResolve;
    const allowed: Record<FeedbackStage, boolean> = {
        open: leave,
        'in-progress': leave,
        ready: (stage === 'ready' && canResolve) || Boolean(verification?.request && onRequestVerification) && !comment.pending,
        done: canResolve
    };
    const canChangeStatus = feedbackStages.some(option => allowed[option]);

    const handleStage = async (next: FeedbackStage, statusId?: string) => {
        if (comment.archivedAt) return;
        if (next === 'ready' && (stage !== 'ready' || !statusId || statusId === selectedStatus?.id)) {
            onRequestVerification?.(statusId);
            return;
        }
        if (next === stage && (!statusId || statusId === selectedStatus?.id)) return;
        try {
            if (statusId && !(stage === 'ready' && (next === 'open' || next === 'in-progress'))) {
                await custom.mutation.mutateAsync({ commentId: comment.id, statusId });
            } else if (stage === 'ready' && next !== 'done') {
                if (cancelAttempt.current?.status !== next) cancelAttempt.current = { status: next, key: newLocalId() };
                await verificationMutation.mutateAsync({ commentId: comment.id, input: {
                    action: 'cancel', override: false, status: next, statusId,
                    expectedRevision: comment.verification?.revision ?? null, idempotencyKey: cancelAttempt.current.key
                } });
                cancelAttempt.current = null;
            } else if (next === 'done' || (stage === 'done' && next === 'open')) {
                // Done and Reopen
                await resolve.mutateAsync({ commentId: comment.id, resolved: next === 'done' });
            } else {
                if (next === 'open' || next === 'in-progress') await progress.mutateAsync({ commentId: comment.id, status: next });
            }
            announce(next === 'done' ? t.thread.markedDone : stage === 'done' && next === 'open' ? t.thread.reopened : t.thread.markedAs(t.status[next]));
        } catch {
            // Shown below
        }
    };

    const handleArchive = async (archived: boolean) => {
        try {
            await archive.mutateAsync({ commentId: comment.id, archived });
            announce(archived ? t.thread.archived : t.thread.restored);
        } catch { /* The mutation error is shown with the thread's other errors. */ }
    };

    const handleMarkUnread = async () => {
        onMarkedUnread?.();
        try {
            await unreadMutation.mutateAsync(comment);
            announce(t.thread.markedUnread);
        } catch {
            // Shown below
        }
    };

    const handlePriority = async (value: CommentPriorityValue) => {
        if (priorityAttempt.current?.priority !== value) priorityAttempt.current = { priority: value, key: newLocalId() };
        try {
            await prioritize.mutateAsync({ commentId: comment.id, priority: value, idempotencyKey: priorityAttempt.current.key });
            priorityAttempt.current = null;
            announce(t.thread.prioritySet(t.priority[value]));
        } catch { /* Keep the intended value and key for retry; shown below */ }
        optionsRef?.current?.focus();
    };

    // The thread in the uier app, the inbox's own link (`?comment=<id>`): only members can open the project there
    const appLink = isMember && toolbarConfig.project
        ? `${toolbarConfig.apiUrl}/app/projects/${encodeURIComponent(toolbarConfig.project)}?${comment.archivedAt ? 'archive=only&' : ''}comment=${encodeURIComponent(comment.id)}`
        : undefined;
    const archiveOptions = custom.workflow.data?.statuses.filter(status => status.category === 'archive') ?? [];

    const handleCopyLink = async () => {
        const link = commentLink(comment, review);
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setUncopiedLink(undefined);
            announce(t.thread.linkCopied);
        } catch {
            // No clipboard access (e.g. not a secure context): show the link to copy by hand
            setUncopiedLink(link);
        }
    };

    return (
        // S and A find the thread's status menu and its people here (`threadShortcuts.ts`)
        <Stack ref={headerRef} spacing={1} data-uier-thread-header="">
            {/* The actions keep to the first line when the author wraps under the status. Where even the status and the
                actions don't fit side by side (a 320 px phone, 44 px touch targets) the actions wrap to a line of their own
                instead of covering the status: the left part's flex basis is its narrowest width */}
            <Row spacing={1} justifyContent="space-between" alignItems="start" className="flex-wrap gap-y-1">
                <Row spacing={1} className="min-w-min grow basis-0 flex-wrap gap-y-1">
                    {/* The first line is as tall as the actions (28 px, 44 px on touch), so its status, number and author
                        centre on them; the strut takes no width, its margin undoes the gap (uier #510) */}
                    <span aria-hidden="true" className="-mr-1 h-7 pointer-coarse:h-11" />
                    {canChangeStatus && !comment.archivedAt
                        ? <CommentStatusMenu verificationEnabled={comment.verificationEnabled === true} stage={stage} allowed={allowed} statuses={custom.workflow.data?.statuses} selectedId={selectedStatus?.id} shortcut={shortcuts}
                            pending={archive.isPending || custom.mutation.isPending || resolve.isPending || progress.isPending || verificationMutation.isPending}
                            onChange={(next, statusId) => void handleStage(next, statusId)} />
                        : <CommentStatusBadge stage={stage} label={selectedStatus ? statusLabel(selectedStatus, t) : undefined} />}
                    {/* The public id, numbered per site */}
                    {comment.number !== undefined && (
                        <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
                            <span className="sr-only">{t.thread.commentNumberPrefix}</span>#{comment.number}
                        </span>
                    )}
                    {unread && <UnreadDot disabled={read.isPending} onRead={() => read.mutate(comment)} />}
                    {comment.archivedAt && <span className="text-xs text-muted-foreground">{t.thread.archivedLabel}</span>}
                    {(reviewInfo?.number !== undefined || canResumeReview) && <span className="inline-flex shrink-0 items-center gap-1">
                        {reviewInfo.number !== undefined &&
                            <span className="text-xs font-medium text-muted-foreground">{t.reviewSessions.number(reviewInfo.number)}</span>}
                        {canResumeReview && <IconTooltip label={t.reviewSessions.resume}>
                            <IconButton type="button" variant="plain" size="xs" className={`${threadActionClassName} pointer-coarse:size-11`}
                                aria-label={t.reviewSessions.resume} disabled={reviewCommand.isPending} onClick={async () => {
                                    try {
                                        await reviewCommand.mutateAsync({ action: 'resume', id: reviewInfo.id });
                                        announce(t.reviewSessions.resumed);
                                        // The button goes with the open review: the focus stays in the thread
                                        optionsRef?.current?.focus();
                                    } catch { /* Keep the action available and show the error. */ }
                                }}>
                                <Play size={14} aria-hidden="true" />
                            </IconButton>
                        </IconTooltip>}
                    </span>}
                    {comment.reviewSession?.held &&
                        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{t.reviewSessions.notSent}</span>}
                    <PriorityBadge comment={comment} />
                    {/* Wraps under the status when the line is too narrow for it, its time under the name when that is too (uier #510) */}
                    {message?.author && <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1" data-uier-thread-author="">{message.author}</span>}
                </Row>
                {/* Always on the first line: the device marks and the actions (uier #470) */}
                <Row className="-mr-1 ml-auto shrink-0">
                    <CommentAssignee comment={comment} className={threadActionClassName} />
                    {message?.device}
                    {/* A comment on its way has no reactions, link, issue or options yet */}
                    {!comment.pending && <>
                        {message?.reaction}
                        {message?.attach}
                        <CopyMenu state={issue} className={compactThreadActionClassName} iconSize={14} linkAvailable={comment.source?.available !== false} onCopyLink={handleCopyLink} />
                        <CommentThreadMenu className={compactThreadActionClassName} triggerRef={optionsRef} actions={{
                            message: message?.actions,
                            assign: comment.permissions?.assign ? { label: assignedText(comment, t), onAssign: () => setAssigning('menu') } : undefined,
                            priority: comment.permissions?.priority ? { value: comment.priority, pending: prioritize.isPending, onChange: handlePriority } : undefined,
                            verify: verification?.request && onRequestVerification
                                ? { label: comment.verification?.outcome === 'pending' && !comment.resolved ? t.thread.requestNewCheck : t.thread.requestVerification, onRequest: onRequestVerification }
                                : undefined,
                            archive: canResolve ? {
                                archived: Boolean(comment.archivedAt), pending: archive.isPending || custom.mutation.isPending,
                                onToggle: () => handleArchive(!comment.archivedAt),
                                destinations: archiveOptions.length > 1 ? archiveOptions.map(status => ({
                                    id: status.id, label: statusLabel(status, t), description: status.description,
                                    selected: Boolean(comment.archivedAt && comment.archiveStatusId === status.id),
                                    onChoose: async () => {
                                        try {
                                            await custom.mutation.mutateAsync({ commentId: comment.id, statusId: status.id });
                                            announce(t.thread.archived);
                                        } catch { /* The thread shows the mutation error below. */ }
                                    }
                                })) : undefined
                            } : undefined,
                            follow: notifications.follow,
                            mute: notifications.mute,
                            markUnread: canMarkUnread ? { pending: unreadMutation.isPending, onMarkUnread: handleMarkUnread } : undefined,
                            openInApp: appLink ? { href: appLink } : undefined
                        }} />
                    </>}
                </Row>
            </Row>
            <CommentsErrorMessage error={reviewCommand.error} />
            {assigning && comment.permissions?.assign && (
                <CommentAssigneeOptions comment={comment} autoFocus={assigning === 'key'} onAssigned={() => { setAssigning(false); optionsRef?.current?.focus(); }} />
            )}
            <CopyIssueResult state={issue} />
            <CommentsErrorMessage error={custom.mutation.error ?? archive.error ?? resolve.error ?? progress.error ?? verificationMutation.error ?? read.error ?? unreadMutation.error ?? prioritize.error ?? notifications.error} />
            {uncopiedLink && (
                <label className="flex flex-col gap-1 text-sm">
                    <span className={destructiveTextClassName}>{t.thread.linkNotCopied}</span>
                    <input
                        readOnly
                        value={uncopiedLink}
                        onFocus={(event) => event.currentTarget.select()}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </label>
            )}
        </Stack>
    );
}
