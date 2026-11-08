'use client';

import { useState, type DragEvent, type MouseEvent } from 'react';
import { ArrowRightLeftIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { KnownPageLinks } from '../../../knownPages';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import { Button } from '@/src/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/src/components/ui/sheet';
import { Spinner } from '@/src/components/ui/spinner';
import { CommentCard, type AssigneeOption } from './CommentCard';
import { CommentRow, commentRowId } from './CommentRow';
import { commentStatus, commentStatusLabels, StateDot, StateMenu, type CommentStatus } from './CommentStatus';
import { allowedStatuses, useStatusChanger } from './useStatusChange';
import type { useOpenComment } from './CommentInbox';

const statuses = ['open', 'ready', 'done'] as const;
const emptyColumn: Record<CommentStatus, string> = { open: 'Nothing open.', ready: 'No checks requested.', done: 'Nothing done yet.' };
/** The dragged thread's id; other drags (text, links, files) are not cards */
const dragType = 'application/x-uier-comment';

/**
 * A board card: the row's summary, dragged by itself to another column, and Move (the same statuses
 * from the keyboard or a touch screen, like the thread's status menu).
 */
function BoardCard({ comment, href, opened, moving, onOpen, onMove, onDragStart, onDragEnd }: {
    comment: ProjectCommentView;
    href: string;
    opened: boolean;
    moving: boolean;
    onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
    onMove: (status: CommentStatus) => void;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
}) {
    const status = commentStatus(comment);
    const allowed = allowedStatuses(comment);
    const canMove = statuses.some(option => option !== status && allowed[option]);
    const name = comment.number !== undefined ? `comment #${comment.number}` : 'comment';
    return (
        <li draggable={canMove && !moving} onDragStart={onDragStart} onDragEnd={onDragEnd}
            className={cn(canMove && 'cursor-grab active:cursor-grabbing', moving && 'opacity-60')}>
            <CommentRow card comment={comment} href={href} selected={opened ? 'opened' : undefined} onOpen={onOpen}
                actions={canMove && (
                    <StateMenu status={status} allowed={allowed} disabled={moving} onChange={onMove}
                        trigger={(
                            <Button variant="ghost" size="icon-xs" aria-label={`Move ${name}`}
                                className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                                {moving ? <Spinner /> : <ArrowRightLeftIcon />}
                            </Button>
                        )} />
                )} />
        </li>
    );
}

/**
 * Open, Ready to verify and Done side by side, as compact cards. A card opens its thread in a sheet
 * (the URL's `?comment=`), so the board stays where it was. Cards move between columns by dragging
 * or with Move; a column a card cannot move to does not take it. Ready to verify opens the thread with
 * the Request verification form, which asks for the details first.
 */
export function CommentBoard({ projectId, columns, allComments, assignees, userId, openComment }: {
    projectId: string;
    columns: Record<CommentStatus, ProjectCommentView[]>;
    allComments: ProjectCommentView[];
    assignees: AssigneeOption[];
    userId: string;
    openComment: ReturnType<typeof useOpenComment>;
}) {
    const { openId, hrefFor, open, close } = openComment;
    const opened = openId ? allComments.find(comment => comment.id === openId) : undefined;
    const { change, pending } = useStatusChanger(projectId);
    const [movingId, setMovingId] = useState<string>();
    // The thread to open with its Request verification form
    const [verifyId, setVerifyId] = useState<string>();
    const [dragging, setDragging] = useState<{ comment: ProjectCommentView; allowed: Record<CommentStatus, boolean>; from: CommentStatus }>();
    const [over, setOver] = useState<CommentStatus>();
    const accepts = (status: CommentStatus) => Boolean(dragging && status !== dragging.from && dragging.allowed[status]);
    const move = (comment: ProjectCommentView, status: CommentStatus) => {
        setMovingId(comment.id);
        change(comment, status, {
            onVerify: () => {
                setVerifyId(comment.id);
                open(comment.id, undefined, { replace: false });
            }
        });
    };
    const closeThread = () => {
        setVerifyId(undefined);
        close();
    };

    return (
        <>
            {/* From lg one row of equal columns, one per status, however many there are */}
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-flow-col lg:grid-cols-none lg:auto-cols-fr">
                {statuses.map(status => (
                    <section key={status} aria-label={`${commentStatusLabels[status]} comments`}
                        onDragOver={event => {
                            if (!accepts(status)) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setOver(status);
                        }}
                        onDragLeave={event => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                                setOver(current => current === status ? undefined : current);
                        }}
                        onDrop={event => {
                            event.preventDefault();
                            setOver(undefined);
                            if (dragging && event.dataTransfer.getData(dragType) === dragging.comment.id && accepts(status))
                                move(dragging.comment, status);
                            setDragging(undefined);
                        }}
                        className={cn('flex min-h-24 flex-col gap-2 rounded-2xl border bg-muted/50 p-2 transition-colors',
                            accepts(status) && 'border-dashed border-foreground/30',
                            over === status && 'bg-muted ring-2 ring-ring')}>
                        <h3 className="m-0 flex items-center gap-2 px-2 pt-1 text-sm font-medium">
                            <StateDot status={status} />
                            {commentStatusLabels[status]}
                            <span className="font-normal tabular-nums text-muted-foreground">{columns[status].length}</span>
                        </h3>
                        {columns[status].length ? (
                            <ul aria-label={`${commentStatusLabels[status]} comments list`} className="m-0 flex list-none flex-col gap-2 p-0">
                                {columns[status].map(comment => (
                                    <BoardCard key={comment.id} comment={comment} href={hrefFor(comment.id)} opened={comment.id === openId}
                                        moving={pending && movingId === comment.id}
                                        onOpen={event => open(comment.id, event, { replace: false })}
                                        onMove={status => move(comment, status)}
                                        onDragStart={event => {
                                            event.dataTransfer.setData(dragType, comment.id);
                                            event.dataTransfer.effectAllowed = 'move';
                                            setDragging({ comment, allowed: allowedStatuses(comment), from: commentStatus(comment) });
                                        }}
                                        onDragEnd={() => { setDragging(undefined); setOver(undefined); }} />
                                ))}
                            </ul>
                        ) : <p className="m-0 px-2 pb-1 text-sm text-muted-foreground">{accepts(status) ? 'Drop here.' : emptyColumn[status]}</p>}
                    </section>
                ))}
            </div>
            <Sheet open={Boolean(opened)} onOpenChange={next => { if (!next) closeThread(); }}>
                <SheetContent side="right" showCloseButton={false} className="gap-0 overflow-x-hidden overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
                    finalFocus={() => (opened ? document.getElementById(commentRowId(opened.id)) : null) ?? true}>
                    <SheetTitle className="sr-only">{opened?.number !== undefined ? `Comment #${opened.number}` : 'Comment'}</SheetTitle>
                    {opened && (
                        <CommentCard key={`${opened.id}-${verifyId === opened.id}`}
                            className="rounded-none border-0 ring-0"
                            projectId={projectId}
                            comment={opened}
                            reviewLink={KnownPageLinks.projectReview(projectId, opened.url, opened.id)}
                            assignees={assignees}
                            userId={userId}
                            startVerifying={verifyId === opened.id}
                            onBack={closeThread} />
                    )}
                </SheetContent>
            </Sheet>
        </>
    );
}
