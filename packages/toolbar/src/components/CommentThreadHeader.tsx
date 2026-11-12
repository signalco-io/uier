'use client';

import { useWorkflowStatus, type WorkflowStatus } from '../hooks/useWorkflowStatus';

import { feedbackStage, feedbackStages, type FeedbackStage } from '../verification';
import { useContext, useEffect, useRef, useState, type RefObject } from 'react';
import { Row } from '@signalco/ui-primitives/Row';
import { Stack } from '@signalco/ui-primitives/Stack';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, ExpandDown } from '@signalco/ui-icons';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { newLocalId, useComments, useReadComment, useUnreadComment } from '../hooks/useComments';
import { commentPriority, type CommentPriority as CommentPriorityValue } from '../triage';
import { commentLink } from '../review';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';
import { CommentItem, destructiveTextClassName, floatingShadowClassName } from './@types/Comments';
import { CopyIssueResult, CopyMenu, useCopyIssue } from './CopyIssue';
import { assignedText, CommentAssignee, CommentAssigneeOptions } from './CommentAssignment';
import { CommentThreadMenu } from './CommentThreadMenu';
import { IconTooltip } from './IconTooltip';
import { useThreadNotificationActions } from './ThreadNotifications';
import { useShortcutsEnabled } from '../shortcuts';
import { assignShortcutEvent } from '../threadShortcuts';
import { keepMovedFocus, toolbarSurface } from '../toolbarReview';
import { moveFocusInMenu } from '../focusKeys';
import { useMessages, type Messages } from '../i18n';

function statusLabel(status: WorkflowStatus, t: Messages) {
    const builtins = { open: 'Open', 'in-progress': 'In progress', ready: 'Ready to verify', done: 'Done', archive: 'Archive' };
    return status.id === status.category && status.label === builtins[status.category]
        ? status.category === 'archive' ? t.inbox.filters.archived : t.status[status.category] : status.label;
}

/** Each status's dot (BRAND.md, "Status"): Open an ink ring (outlined), In progress sky, Ready to verify violet, Done green. The app's `StateDot`. */
const stageDotColors: Record<FeedbackStage, string> = {
    open: 'border border-foreground',
    'in-progress': 'bg-[hsl(var(--brand-in-progress))]',
    ready: 'bg-[hsl(var(--brand-ready))]',
    done: 'bg-[hsl(var(--brand-success))]'
};

export function StatusDot({ stage }: { stage: FeedbackStage }) {
    return <span aria-hidden="true" data-status-dot={stage} className={cx('size-1.5 shrink-0 rounded-full', stageDotColors[stage])} />;
}

/** "Open", "In progress", "Ready to verify" or "Done", with the status dot in its colour. The app's `StateBadge`. */
export function CommentStatusBadge({ stage, label }: { stage: FeedbackStage; label?: string }) {
    const t = useMessages();
    return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">
            <StatusDot stage={stage} />
            <span className="sr-only">{t.thread.statusPrefix}</span>
            {label ?? t.status[stage]}
        </span>
    );
}

/**
 * The status badge as a menu with every status, like the app's `StateMenu`: each is enabled when the
 * person may move the thread there (`allowed`). Ready to verify opens the Request verification form
 * (again while a check is pending); from Ready to verify, Done says Done without verification. S moves
 * the focus to the badge (`data-uier-status`); Enter or Space opens it, the current status focused.
 */
function CommentStatusMenu({ stage, allowed, pending, shortcut, onChange, statuses, selectedId, canArchive }: {
    stage: FeedbackStage;
    allowed: Record<FeedbackStage, boolean>;
    pending: boolean;
    shortcut: boolean;
    statuses?: WorkflowStatus[]; selectedId?: string; canArchive: boolean;
    onChange: (stage: FeedbackStage | 'archive', statusId?: string) => void;
}) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const t = useMessages();
    const [open, setOpen] = useState(false);
    const currentRef = useRef<HTMLButtonElement>(null);
    // Ready to verify waits for the menu to close: its form then takes the focus
    const requesting = useRef<string | false>(false);
    const options = [...feedbackStages, 'archive' as const].flatMap(category => statuses?.filter(status => status.category === category) ?? (category === 'archive' ? [] : [{ id: category, category, label: t.status[category], description: '' }]));
    const localizedOptions = options.map(option => ({ ...option, label: statusLabel(option, t) }));
    const selected = localizedOptions.find(option => option.id === selectedId) ?? localizedOptions.find(option => option.category === stage);
    const label = selected?.label ?? t.status[stage];
    const choose = (option: WorkflowStatus) => {
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
            container={rootElement}
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
                    className="h-6 shrink-0 gap-1.5 rounded-full px-2 text-xs font-medium"
                    aria-label={t.thread.changeStatus(label)}
                    aria-keyshortcuts={shortcut ? 'S' : undefined}
                    data-uier-status=""
                    data-uier-thread-control="">
                    <StatusDot stage={stage} />
                    <span className="sr-only">{t.thread.statusPrefix}</span>
                    {label}
                    <ExpandDown aria-hidden="true" size={12} className="text-muted-foreground" />
                </Button>
            )}
            {...contentProps}>
            <Stack role="group" aria-label={t.thread.setStatus}>
                {localizedOptions.map((option, index) => {
                    const current = option.id === selected?.id;
                    const enabled = option.category === 'archive' ? canArchive : allowed[option.category];
                    const categoryStart = index === 0 || options[index - 1]?.category !== option.category;
                    return <Stack key={option.id}>
                        {categoryStart && <span className="px-2 py-1 text-xs text-muted-foreground">{option.category === 'archive' ? t.inbox.filters.archived : t.status[option.category]}</span>}
                        <Button ref={current ? currentRef : undefined} variant="plain" size="sm" fullWidth className="justify-start"
                            aria-pressed={current} disabled={pending || (!current && !enabled)} title={option.description || undefined}
                            startDecorator={option.category !== 'archive' ? <StatusDot stage={option.category} /> : undefined}
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
 * marks the thread read), a priority other than Normal and the assignee's avatar, then the actions:
 * Copy (the issue or the link) and Thread options with the triage and email controls each person may
 * use (assign, priority, Request verification, follow, mute, Mark as unread). The status is a menu
 * (Open, In progress, Ready to verify, Done) for those who may change it, else a badge. The people to
 * assign open under the line. `onMarkedUnread`: the reviewer asked for the thread to stay unread (no
 * automatic read while open).
 */
export function CommentThreadHeader({ comment, onMarkedUnread, onRequestVerification, optionsRef }: {
    comment: CommentItem;
    onMarkedUnread?: () => void;
    /** Thread options' Request verification and the status menu's Ready to verify: the form opens in the thread */
    onRequestVerification?: (statusId?: string) => void;
    /** Thread options' button, where focus returns from the forms it opens */
    optionsRef?: RefObject<HTMLButtonElement | null>;
}) {
    const { review } = useContext(CommentsBootstrapperContext);
    const t = useMessages();
    const { resolve, progress, archive, prioritize, verification: verificationMutation } = useComments();
    const read = useReadComment();
    const unreadMutation = useUnreadComment();
    const announce = useAnnounce();
    const [uncopiedLink, setUncopiedLink] = useState<string>();
    const stage = feedbackStage(comment);
    const custom = useWorkflowStatus();
    const selectedStatusId = comment.archivedAt ? comment.archiveStatusId : comment.workflowStatusId;
    const workflow = custom.workflow.data;
    const category = comment.archivedAt ? 'archive' : stage;
    const fallbackId = category === 'archive' ? workflow?.archiveStatusId : category === 'done' ? workflow?.doneStatusId : undefined;
    const selectedStatus = workflow?.statuses.find(status => status.id === selectedStatusId && status.category === category)
        ?? workflow?.statuses.find(status => status.id === fallbackId && status.category === category)
        ?? workflow?.statuses.find(status => status.category === category);
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

    const handleStage = async (next: FeedbackStage | 'archive', statusId?: string) => {
        if (next === 'ready' && (stage !== 'ready' || !statusId || statusId === selectedStatus?.id)) {
            onRequestVerification?.(statusId);
            return;
        }
        if (next === stage && (!statusId || statusId === selectedStatus?.id)) return;
        try {
            if (statusId && !(stage === 'ready' && (next === 'open' || next === 'in-progress'))) {
                await custom.mutation.mutateAsync({ commentId: comment.id, statusId });
            } else if (next === 'archive') return;
            else if (stage === 'ready' && next !== 'done') {
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
            announce(next === 'done' ? t.thread.markedDone : stage === 'done' && next === 'open' ? t.thread.reopened : t.thread.markedAs(next === 'archive' ? t.thread.archivedLabel : t.status[next]));
        } catch {
            // Shown below
        }
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
            <Row spacing={1} justifyContent="space-between" className="flex-nowrap">
                <Row spacing={1} className="min-w-0 flex-wrap gap-y-1">
                    {canChangeStatus
                        ? <CommentStatusMenu stage={stage} allowed={allowed} statuses={custom.workflow.data?.statuses} selectedId={selectedStatus?.id} canArchive={canResolve} shortcut={shortcuts}
                            pending={custom.mutation.isPending || resolve.isPending || progress.isPending || verificationMutation.isPending}
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
                    <PriorityBadge comment={comment} />
                    <CommentAssignee comment={comment} className={threadActionClassName} />
                </Row>
                {/* A comment on its way has no link, issue or options yet */}
                {!comment.pending && (
                    <Row className="-mr-1.5 shrink-0">
                        <CopyMenu state={issue} className={threadActionClassName} linkAvailable={comment.source?.available !== false} onCopyLink={handleCopyLink} />
                        <CommentThreadMenu className={threadActionClassName} triggerRef={optionsRef} actions={{
                            assign: comment.permissions?.assign ? { label: assignedText(comment, t), onAssign: () => setAssigning('menu') } : undefined,
                            priority: comment.permissions?.priority ? { value: comment.priority, pending: prioritize.isPending, onChange: handlePriority } : undefined,
                            verify: verification?.request && onRequestVerification
                                ? { label: comment.verification?.outcome === 'pending' && !comment.resolved ? t.thread.requestNewCheck : t.thread.requestVerification, onRequest: onRequestVerification }
                                : undefined,
                            archive: canResolve ? { archived: Boolean(comment.archivedAt), pending: archive.isPending, onToggle: async () => {
                                try {
                                    await archive.mutateAsync({ commentId: comment.id, archived: !comment.archivedAt });
                                    announce(comment.archivedAt ? t.thread.restored : t.thread.archived);
                                } catch { /* The mutation error is shown with the thread's other errors. */ }
                            } } : undefined,
                            follow: notifications.follow,
                            mute: notifications.mute,
                            markUnread: canMarkUnread ? { pending: unreadMutation.isPending, onMarkUnread: handleMarkUnread } : undefined
                        }} />
                    </Row>
                )}
            </Row>
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
