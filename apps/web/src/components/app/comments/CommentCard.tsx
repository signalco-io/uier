'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Modal } from '@signalco/ui-primitives/Modal';
import { cx } from '@signalco/ui-primitives/cx';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@signalco/ui-primitives/Menu';
import { ModalConfirm } from '@signalco/ui/ModalConfirm';
import { showNotification } from '@signalco/ui-notifications';
import { Check, Delete, Desktop, Edit, Link, Lock, Mobile, MoreHorizontal, Tablet, Undo, User } from '@signalco/ui-icons';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import type { ActionState } from '../../../lib/app/actionResult';
import { destructiveTextClassName } from '../PageHeader';
import { DateTime } from './DateTime';
import { deviceLabels, kindLabels } from './commentLabels';
import {
    deleteCommentAction,
    editCommentAction,
    setCommentAssigneeAction,
    setCommentPrivateAction,
    setCommentResolvedAction
} from './actions';

export type AssigneeOption = { userId: string; name: string };

const deviceIcons = { desktop: Desktop, tablet: Tablet, mobile: Mobile } as const;

const maxTextLength = 1000;

/** Open: ink dot; done: green (BRAND.md, "Components": badges with a status dot) */
function StateBadge({ resolved }: { resolved: boolean }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
            <span aria-hidden="true" className={cx('size-1.5 rounded-full', resolved ? 'bg-[hsl(var(--brand-success))]' : 'bg-foreground')} />
            {resolved ? 'Done' : 'Open'}
        </span>
    );
}

/** A project comment in the app's list and board: what, where, who and when, with its actions */
export function CommentCard({ projectId, comment, reviewLink, assignees }: {
    projectId: string;
    comment: ProjectCommentView;
    /** Review link that opens the page at this comment */
    reviewLink: string;
    assignees: AssigneeOption[];
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [showReplies, setShowReplies] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState(comment.text);
    const [editError, setEditError] = useState<string>();
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const DeviceIcon = comment.device ? deviceIcons[comment.device] : undefined;
    const { permissions } = comment;
    const label = comment.deleted ? 'Deleted comment' : `Comment by ${comment.author.isMe ? 'you' : comment.author.name}`;

    const run = (action: () => Promise<ActionState>, success?: string) => startTransition(async () => {
        const result = await action();
        if (result && !result.ok) {
            showNotification(result.error, 'error');
            return;
        }
        if (success)
            showNotification(success, 'success');
        router.refresh();
    });

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(new URL(reviewLink, window.location.href).toString());
            showNotification('Link copied. It opens the page at this comment.', 'success');
        } catch {
            showNotification('Couldn\'t copy the link.', 'error');
        }
    };

    const saveEdit = () => startTransition(async () => {
        const result = await editCommentAction(projectId, comment.id, editText);
        if (result && !result.ok) {
            setEditError(result.error);
            return;
        }
        setEditing(false);
        router.refresh();
    });

    return (
        <article aria-label={label} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <StateBadge resolved={comment.resolved} />
                    {comment.number !== undefined && (
                        <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
                            <span className="sr-only">Comment </span>#{comment.number}
                        </span>
                    )}
                    {comment.kind !== 'comment' && (
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
                            {kindLabels[comment.kind]}
                        </span>
                    )}
                    {comment.private && (
                        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium">
                            <Lock aria-hidden="true" className="size-3" />
                            Private
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {permissions.resolve && (
                        <Button
                            variant="outlined"
                            size="sm"
                            disabled={pending}
                            startDecorator={comment.resolved ? <Undo className="size-4" /> : <Check className="size-4" />}
                            onClick={() => run(() => setCommentResolvedAction(projectId, comment.id, !comment.resolved))}>
                            {comment.resolved ? 'Reopen' : 'Done'}
                        </Button>
                    )}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <IconButton variant="plain" size="sm" disabled={pending} aria-label={`More actions for the ${label.toLowerCase()}`} title="More actions">
                                <MoreHorizontal />
                            </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-48">
                            <DropdownMenuItem startDecorator={<Link className="size-4" />} onSelect={copyLink}>
                                Link to comment
                            </DropdownMenuItem>
                            {permissions.assign && (
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                        <User className="mr-2 size-4" />
                                        Assign
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Assign to</DropdownMenuLabel>
                                        {assignees.map(option => (
                                            <DropdownMenuItem
                                                key={option.userId}
                                                startDecorator={option.userId === comment.assignee?.id ? <Check className="size-4" /> : <span className="size-4" />}
                                                onSelect={() => run(() => setCommentAssigneeAction(projectId, comment.id, option.userId), `Assigned to ${option.name}.`)}>
                                                {option.name}
                                            </DropdownMenuItem>
                                        ))}
                                        {comment.assignee && (
                                            <>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onSelect={() => run(() => setCommentAssigneeAction(projectId, comment.id, null))}>
                                                    Unassign
                                                </DropdownMenuItem>
                                            </>
                                        )}
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            )}
                            {permissions.edit && (
                                <DropdownMenuItem
                                    startDecorator={<Edit className="size-4" />}
                                    onSelect={() => {
                                        setEditText(comment.text);
                                        setEditError(undefined);
                                        setEditing(true);
                                    }}>
                                    Edit
                                </DropdownMenuItem>
                            )}
                            {permissions.makePrivate && (
                                <DropdownMenuItem
                                    startDecorator={<Lock className="size-4" />}
                                    onSelect={() => run(
                                        () => setCommentPrivateAction(projectId, comment.id, !comment.private),
                                        comment.private ? 'Everyone with access sees this comment again.' : 'Only admins and the author see this comment now.')}>
                                    {comment.private ? 'Make public' : 'Make private'}
                                </DropdownMenuItem>
                            )}
                            {permissions.delete && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        startDecorator={<Delete className="size-4" />}
                                        className={destructiveTextClassName}
                                        onSelect={() => setConfirmingDelete(true)}>
                                        Delete
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {comment.quotedText && (
                <blockquote className="m-0 line-clamp-3 border-l-2 border-muted-foreground bg-muted px-2 py-1 text-sm text-secondary-foreground">
                    {comment.quotedText}
                </blockquote>
            )}
            {comment.deleted
                ? <p className="m-0 text-sm text-muted-foreground">Comment deleted</p>
                : <p className="m-0 whitespace-pre-wrap break-words text-sm">{comment.text}{comment.edited && <span className="text-muted-foreground"> (edited)</span>}</p>}

            {comment.screenshot && (
                // The author's screenshot of the commented part of the page; opens full size
                <a href={comment.screenshot.url} target="_blank" rel="noopener" className="block self-start rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <img
                        src={comment.screenshot.url}
                        width={comment.screenshot.width}
                        height={comment.screenshot.height}
                        alt="Screenshot of the commented part of the page"
                        loading="lazy"
                        className="block h-auto max-h-64 w-auto max-w-full rounded-md border" />
                </a>
            )}

            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Page</dt>
                <dd className="m-0 min-w-0">
                    <a href={reviewLink} target="_blank" rel="noopener" className="block truncate font-mono text-[13px] hover:underline">
                        {comment.url.replace(/^https?:\/\//, '')}
                    </a>
                </dd>
                <dt className="text-muted-foreground">From</dt>
                <dd className="m-0 flex flex-wrap items-center gap-x-2">
                    <span>{comment.author.isMe ? 'You' : comment.author.name}</span>
                    {DeviceIcon && comment.device && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <DeviceIcon aria-hidden="true" className="size-4" />
                            {deviceLabels[comment.device]}
                        </span>
                    )}
                </dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd className="m-0"><DateTime value={comment.createdAt} /></dd>
                <dt className="text-muted-foreground">Assignee</dt>
                <dd className="m-0">{comment.assignee?.name ?? <span className="text-muted-foreground">Nobody</span>}</dd>
            </dl>

            {comment.replies.length > 0 && (
                <div className="flex flex-col gap-2">
                    <Button
                        variant="plain"
                        size="sm"
                        className="self-start"
                        aria-expanded={showReplies}
                        onClick={() => setShowReplies(show => !show)}>
                        {showReplies ? 'Hide replies' : `${comment.replies.length} ${comment.replies.length === 1 ? 'reply' : 'replies'}`}
                    </Button>
                    {showReplies && (
                        <ol className="m-0 flex list-none flex-col gap-3 border-l-2 pl-3">
                            {comment.replies.map(reply => (
                                <li key={reply.id} className="flex flex-col gap-0.5 text-sm">
                                    <span className="flex flex-wrap items-baseline gap-x-2">
                                        <span className="font-medium">{reply.author.isMe ? 'You' : reply.author.name}</span>
                                        <span className="text-xs text-muted-foreground"><DateTime value={reply.createdAt} /></span>
                                    </span>
                                    <span className="whitespace-pre-wrap break-words">{reply.text}</span>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            )}

            <Modal title="Edit comment" open={editing} onOpenChange={setEditing}>
                <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        saveEdit();
                    }}>
                    <h2 className="m-0 text-xl font-semibold tracking-[-0.015em]">Edit comment</h2>
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Text
                        <textarea
                            value={editText}
                            onChange={(event) => setEditText(event.target.value)}
                            rows={5}
                            maxLength={maxTextLength}
                            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" />
                    </label>
                    {editError && <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName)}>{editError}</p>}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="plain" onClick={() => setEditing(false)}>Cancel</Button>
                        <Button type="submit" variant="solid" loading={pending}>Save</Button>
                    </div>
                </form>
            </Modal>

            <ModalConfirm
                title="Delete comment"
                header="Delete this comment?"
                open={confirmingDelete}
                onOpenChange={setConfirmingDelete}
                onConfirm={() => run(() => deleteCommentAction(projectId, comment.id), 'Comment deleted.')}>
                {comment.replies.length
                    ? `The comment and its ${comment.replies.length} ${comment.replies.length === 1 ? 'reply are' : 'replies are'} deleted for everyone.`
                    : 'The comment is deleted for everyone.'}
            </ModalConfirm>
        </article>
    );
}
