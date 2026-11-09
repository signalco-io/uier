'use client';

import { useRef, type MouseEvent, type ReactNode } from 'react';
import { BugIcon, GitPullRequestIcon, HeartIcon, LockIcon, ReplaceIcon } from 'lucide-react';
import { commentAssignees } from '@uier/toolbar/agents';
import { markdownPlainText } from '@uier/toolbar/markdown';
import { cn } from '@/src/lib/utils';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { RelativeTime } from './DateTime';
import { SelectComment } from './TriageSelection';
import { AssigneeAvatars } from './AgentAvatar';
import { AssigneeCard } from './AssigneeCard';
import { AuthorAvatar } from './AuthorAvatar';
import { commentStatus, commentStatusLabels, StateDot } from './CommentStatus';
import { PriorityLabel } from './PriorityFlag';
import { commentPullRequestLinks, PullRequestCard } from './ThreadPullRequests';

const kindIcons = { feedback: HeartIcon, bug: BugIcon, rewrite: ReplaceIcon } as const;

/** The row's title: the thread's AI title, else the first line of the first message */
export function commentTitle(comment: ProjectCommentView) {
    if (comment.deleted) return 'Comment deleted';
    if (comment.title) return comment.title;
    // The words without their Markdown: `**Fixed** in [abc1234](…)` reads "Fixed in abc1234"
    const line = markdownPlainText(comment.displayText, comment.displayMentions).split('\n').map(text => text.trim()).find(Boolean);
    return line ?? (comment.anchor.type === 'text' ? comment.anchor.text : '');
}

/** The id of a row's link, to give it the focus back */
export const commentRowId = (id: string) => `comment-row-${id}`;

/**
 * One comment in the inbox list or on the board. The title line: unread, who wrote it (`AuthorAvatar`: its tooltip
 * names them), number, title (`commentTitle`) and age. The meta line: the page path, private, a linked pull request (`PullRequestCard`: hovering or tapping it lists the thread's pull requests),
 * priority other than Normal (its flag, named for assistive tech), status (Open too; a board card leaves it to its
 * column), then at its right end who it is assigned to (`AssigneeCard`: each assignee's avatar with its agents' marks on
 * its edge; hovering them shows the assignees and their agents). The meta line starts under the title, so the path lines up
 * with "#12 …"; the selection box (`SelectComment`) sits before it, under the author. The box shows only while the row is
 * hovered, focused or selecting, but keeps its room, so nothing moves when it appears. The whole row opens the thread (a link to `?comment=<id>`, so it can also
 * open in a new tab).
 */
export function CommentRow({ comment, href, selected, onOpen, card = false, preview = false, actions, describedBy, keyShortcuts, project, projectId, tabbable = true }: {
    comment: ProjectCommentView;
    href: string;
    /** Its thread is open (`opened`), or shown beside the list until another is chosen (`beside`, wide layouts only) */
    selected?: 'opened' | 'beside';
    /** Opens the thread in place; without it, the link navigates */
    onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
    /** A board card: bordered, a title of up to two lines, no status (its column says it); its link is not dragged on its own */
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
    /** The thread's project: with it, the linked pull request mark shows the pull requests on hover or tap */
    projectId?: string;
    /**
     * Its link and selection box are in the Tab order. The inbox list keeps only one row there (a roving
     * tab stop) and moves between rows with the arrow keys.
     */
    tabbable?: boolean;
}) {
    const people = commentAssignees(comment);
    const userId = comment.assignedUserId;
    const status = commentStatus(comment);
    const unread = Boolean(comment.activity?.unread);
    const KindIcon = comment.kind === 'comment' ? undefined : kindIcons[comment.kind];
    const title = commentTitle(comment);
    const pullRequests = commentPullRequestLinks(comment);
    const link = useRef<HTMLAnchorElement>(null);
    // A click on the author's or a mouse click on the assignee's avatars or the pull request mark opens the thread like the rest of the row, modifier keys and all
    const openFromAvatars = (event: MouseEvent) => link.current?.dispatchEvent(new window.MouseEvent('click', {
        bubbles: true, cancelable: true, view: window, button: event.button,
        ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey
    }));
    return (
        <div data-comment-row="" className={cn('group/row relative flex min-w-0 gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring',
            selected === 'opened' && 'bg-muted hover:bg-muted',
            selected === 'beside' && '@3xl/comments:bg-muted @3xl/comments:hover:bg-muted',
            // On dark the surface is as dark as the column: the page's black sets a card apart from it
            card && 'border bg-card hover:bg-muted/40 dark:bg-background dark:hover:bg-muted/40',
            // Selected for a bulk action
            'has-[[data-slot=checkbox][data-checked]]:bg-muted/60')}>
            {/* Two columns: the unread dot and the author over the selection box, then the title over the meta line, so the page path lines up with "#12 …" */}
            <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
                {/* Who wrote it starts the title line, before "#12 …"; centred on its first line, like the unread dot */}
                <span className="flex h-5 shrink-0 items-center gap-2">
                    {unread && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[hsl(var(--brand-accent))]" />}
                    <AuthorAvatar author={comment.author} deleted={comment.deleted} onPress={openFromAvatars} />
                </span>
                <div className="flex min-w-0 items-baseline gap-2">
                    <a ref={link} id={preview ? undefined : commentRowId(comment.id)} href={href} onClick={onOpen} aria-current={selected === 'opened' ? 'true' : undefined} draggable={card ? false : undefined}
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
                    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums"><RelativeTime value={comment.createdAt} short /></span>
                    {actions}
                </div>
                {/* The selection box, under the author's own avatar (past the unread dot's room). The slot stays when the box is
                    hidden or absent, so the path never moves */}
                <span className="flex h-5 items-center gap-2 self-center">
                    {unread && <span aria-hidden="true" className="w-2 shrink-0" />}
                    <span className="flex w-5 shrink-0 justify-center"><SelectComment comment={comment} tabbable={tabbable} /></span>
                </span>
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <p className="m-0 flex min-w-0 flex-1 items-center gap-1.5">
                        {KindIcon && <KindIcon aria-hidden="true" className="size-3.5 shrink-0" />}
                        <span className="truncate">
                            {project && <><span className="font-medium text-foreground">{project}</span><span aria-hidden="true"> · </span></>}
                            <span className="sr-only">Page </span>
                            <span className="font-mono">{comment.path}</span>
                        </span>
                    </p>
                    <div className="flex min-h-5 shrink-0 items-center gap-2">
                        {comment.private && <LockIcon aria-label="Private" className="size-3 shrink-0" />}
                        {/* Hovering or tapping the mark shows the pull requests; the dragged copy of a card and a row without its project keep the plain mark */}
                        {pullRequests.length > 0 && (preview || !projectId
                            ? <GitPullRequestIcon aria-label="Linked pull request" className="size-3.5" />
                            : <PullRequestCard projectId={projectId} comment={comment} links={pullRequests} tabbable={tabbable} onPress={openFromAvatars} />)}
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
                        {/* The right end: the assignees. The dragged copy of a card is inert: its avatars need no card */}
                        {people.length > 0 && (preview
                            ? <AssigneeAvatars assignees={people} userId={userId} />
                            : <AssigneeCard assignees={people} userId={userId} tabbable={tabbable} onPress={openFromAvatars} />)}
                    </div>
                </div>
            </div>
        </div>
    );
}
