'use client';

import type { MouseEvent, ReactNode } from 'react';
import { BugIcon, HeartIcon, LockIcon, ReplaceIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { RelativeTime } from './DateTime';
import { SelectComment } from './TriageSelection';
import { AssigneeAvatars } from './AgentAvatar';
import { commentStatus, commentStatusLabels, StateDot } from './CommentStatus';
import { PriorityLabel } from './PriorityFlag';

const kindIcons = { feedback: HeartIcon, bug: BugIcon, rewrite: ReplaceIcon } as const;

/** The row's title: the thread's AI title, else the first line of the first message */
export function commentTitle(comment: ProjectCommentView) {
    if (comment.deleted) return 'Comment deleted';
    if (comment.title) return comment.title;
    const line = comment.displayText.split('\n').map(text => text.trim()).find(Boolean);
    return line ?? (comment.anchor.type === 'text' ? comment.anchor.text : '');
}

/** The id of a row's link, to give it the focus back */
export const commentRowId = (id: string) => `comment-row-${id}`;

/**
 * One comment in the inbox list or on the board: number, title (`commentTitle`), who wrote it, the page path,
 * priority other than Normal (its flag, named for assistive tech), who it is assigned to, status (Open too; a board
 * card leaves it to its column), age and unread. The whole row opens the thread (a link to `?comment=<id>`, so it can also open
 * in a new tab); the selection box sits beside the link.
 */
export function CommentRow({ comment, href, selected, onOpen, card = false, preview = false, actions, describedBy, keyShortcuts, project, tabbable = true }: {
    comment: ProjectCommentView;
    href: string;
    /** Its thread is open (`opened`), or shown beside the list until another is chosen (`beside`, wide layouts only) */
    selected?: 'opened' | 'beside';
    /** Opens the thread in place; without it, the link navigates */
    onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
    /** A board card: bordered, the meta on lines of its own; its link is not dragged on its own */
    card?: boolean;
    /** The copy of a card that follows the pointer while it is dragged: its link has no id */
    preview?: boolean;
    /**
     * Controls at the end of the first line (the board card's Move). They place themselves above the link that
     * covers the row (`relative z-10`) and take no room while visually hidden (`sr-only`).
     */
    actions?: ReactNode;
    /** The id of what else assistive tech reads for the link (a board card's keyboard shortcut) */
    describedBy?: string;
    /** The keys that act on the focused link (`aria-keyshortcuts`) */
    keyShortcuts?: string;
    /** The project's name, where rows of several projects are listed together (My work) */
    project?: string;
    /**
     * Its link and selection box are in the Tab order. The inbox list keeps only one row there (a roving
     * tab stop) and moves between rows with the arrow keys.
     */
    tabbable?: boolean;
}) {
    const status = commentStatus(comment);
    const unread = Boolean(comment.activity?.unread);
    const author = comment.deleted ? 'Deleted' : comment.author.isMe ? 'You' : comment.author.name;
    const KindIcon = comment.kind === 'comment' ? undefined : kindIcons[comment.kind];
    const title = commentTitle(comment);
    return (
        <div className={cn('group/row relative flex min-w-0 gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring',
            selected === 'opened' && 'bg-muted hover:bg-muted',
            selected === 'beside' && '@4xl/comments:bg-muted @4xl/comments:hover:bg-muted',
            card && 'border bg-card hover:bg-muted/40')}>
            {/* Above the link that covers the row */}
            <div className="relative z-10 flex h-5 shrink-0 items-center empty:hidden">
                <SelectComment comment={comment} tabbable={tabbable} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-baseline gap-2">
                    {unread && <span aria-hidden="true" className="size-2 shrink-0 self-center rounded-full bg-[hsl(var(--brand-accent))]" />}
                    <a id={preview ? undefined : commentRowId(comment.id)} href={href} onClick={onOpen} aria-current={selected === 'opened' ? 'true' : undefined} draggable={card ? false : undefined}
                        aria-describedby={describedBy} aria-keyshortcuts={keyShortcuts}
                        tabIndex={tabbable ? undefined : -1}
                        className={cn('min-w-0 flex-1 text-sm outline-none after:absolute after:inset-0 after:rounded-lg', card ? 'line-clamp-2 break-words' : 'truncate',
                            unread ? 'font-semibold' : 'font-medium', comment.deleted && 'text-muted-foreground')}>
                        {comment.number !== undefined && <>
                            <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">
                                <span className="sr-only">Comment </span>#{comment.number}
                            </span>{' '}
                        </>}
                        {comment.number === undefined && <span className="sr-only">Comment: </span>}
                        {title}
                        {unread && <span className="sr-only">, unread</span>}
                    </a>
                    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums"><RelativeTime value={comment.createdAt} /></span>
                    {actions}
                </div>
                <div className={cn('flex min-w-0 gap-x-2 gap-y-1 text-xs text-muted-foreground', card ? 'flex-col' : 'items-center')}>
                    <p className="m-0 flex min-w-0 flex-1 items-center gap-1.5">
                        {KindIcon && <KindIcon aria-hidden="true" className="size-3.5 shrink-0" />}
                        <span className="truncate">
                            {project && <><span className="font-medium text-foreground">{project}</span><span aria-hidden="true"> · </span><span className="sr-only">, by </span></>}
                            {author}
                            <span aria-hidden="true"> · </span><span className="sr-only">, page </span>
                            <span className="font-mono">{comment.path}</span>
                        </span>
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                        {comment.private && <LockIcon aria-label="Private" className="size-3.5" />}
                        {/* Normal is the default: only a priority that differs gets its flag */}
                        {comment.priority !== 'normal' && <PriorityLabel priority={comment.priority} />}
                        {/* Every row says its status (Active mixes them); a board card's column (named for assistive tech) already does */}
                        {!card && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap text-foreground">
                                <StateDot status={status} />
                                <span className="sr-only">Status: </span>
                                {commentStatusLabels[status]}
                            </span>
                        )}
                        {comment.assignee && <AssigneeAvatars assignee={comment.assignee} />}
                    </div>
                </div>
            </div>
        </div>
    );
}
