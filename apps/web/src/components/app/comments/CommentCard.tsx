'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
    CheckIcon,
    ChevronDownIcon,
    ExternalLinkIcon,
    LinkIcon,
    LockIcon,
    LockOpenIcon,
    MonitorIcon,
    MoreHorizontalIcon,
    PencilIcon,
    SmartphoneIcon,
    TabletIcon,
    Trash2Icon,
    Undo2Icon,
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
import { Avatar, AvatarFallback } from '@/src/components/ui/avatar';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
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
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { Field, FieldError, FieldLabel } from '@/src/components/ui/field';
import { Spinner } from '@/src/components/ui/spinner';
import { Textarea } from '@/src/components/ui/textarea';
import type { ProjectCommentView } from '../../../lib/app/projectComments';
import type { ActionState } from '../../../lib/app/actionResult';
import { initials } from '../initials';
import { DateTime } from './DateTime';
import { CommentReproduction } from './CommentReproduction';
import { NotificationControls } from './NotificationControls';
import { deviceLabels, kindLabels } from './commentLabels';
import {
    markCommentReadAction,
    deleteCommentAction,
    editCommentAction,
    setCommentAssigneeAction,
    setCommentPrivateAction,
    setCommentResolvedAction
} from './actions';

export type AssigneeOption = { userId: string; name: string };

const deviceIcons = { desktop: MonitorIcon, tablet: TabletIcon, mobile: SmartphoneIcon } as const;

const maxTextLength = 1000;

/** Open: ink dot; done: green (BRAND.md, "Components": badges with a status dot) */
function StateBadge({ resolved }: { resolved: boolean }) {
    return (
        <Badge variant="outline" className="gap-1.5">
            <span aria-hidden="true" className={resolved ? 'size-1.5 rounded-full bg-[hsl(var(--brand-success))]' : 'size-1.5 rounded-full bg-foreground'} />
            {resolved ? 'Done' : 'Open'}
        </Badge>
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
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState(comment.text);
    const [editError, setEditError] = useState<string>();
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const DeviceIcon = comment.device ? deviceIcons[comment.device] : undefined;
    const { permissions } = comment;
    const author = comment.author.isMe ? 'You' : comment.author.name;
    const label = comment.deleted ? 'Deleted comment' : `Comment by ${comment.author.isMe ? 'you' : comment.author.name}`;

    const run = (action: () => Promise<ActionState>, success?: string) => startTransition(async () => {
        const result = await action();
        if (result && !result.ok) {
            toast.error(result.error);
            return;
        }
        if (success)
            toast.success(success);
        router.refresh();
    });

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(new URL(reviewLink, window.location.href).toString());
            toast.success('Link copied. It opens the page at this comment.');
        } catch {
            toast.error('Couldn\'t copy the link.');
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
        <Card role="article" aria-label={label} className="gap-0 py-0">
            <div className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                    <Avatar size="sm" aria-hidden="true" className="mt-0.5">
                        <AvatarFallback>{comment.deleted ? '?' : initials(author)}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 pt-1 text-sm leading-5">
                        <span className="font-medium">{comment.deleted ? 'Deleted' : author}</span>
                        {DeviceIcon && comment.device && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <DeviceIcon aria-hidden="true" className="size-3.5" />
                                {deviceLabels[comment.device]}
                            </span>
                        )}
                        <span className="text-[13px] text-muted-foreground"><DateTime value={comment.createdAt} /></span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {permissions.resolve && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={pending}
                                onClick={() => run(() => setCommentResolvedAction(projectId, comment.id, !comment.resolved))}>
                                {comment.resolved ? <Undo2Icon data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
                                {comment.resolved ? 'Reopen' : 'Done'}
                            </Button>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`More actions for the ${label.toLowerCase()}`}>
                                    {pending ? <Spinner /> : <MoreHorizontalIcon />}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-48">
                                <DropdownMenuGroup>
                                    <DropdownMenuItem onSelect={copyLink}>
                                        <LinkIcon />
                                        Link to comment
                                    </DropdownMenuItem>
                                    {permissions.assign && (
                                        <DropdownMenuSub>
                                            <DropdownMenuSubTrigger>
                                                <UserIcon />
                                                Assign
                                            </DropdownMenuSubTrigger>
                                            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                                                <DropdownMenuGroup>
                                                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Assign to</DropdownMenuLabel>
                                                    {assignees.map(option => (
                                                        <DropdownMenuItem
                                                            key={option.userId}
                                                            onSelect={() => run(() => setCommentAssigneeAction(projectId, comment.id, option.userId), `Assigned to ${option.name}.`)}>
                                                            {option.name}
                                                            {option.userId === comment.assignee?.id && <CheckIcon className="ml-auto" />}
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuGroup>
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
                                            onSelect={() => {
                                                setEditText(comment.text);
                                                setEditError(undefined);
                                                setEditing(true);
                                            }}>
                                            <PencilIcon />
                                            Edit
                                        </DropdownMenuItem>
                                    )}
                                    {permissions.makePrivate && (
                                        <DropdownMenuItem
                                            onSelect={() => run(
                                                () => setCommentPrivateAction(projectId, comment.id, !comment.private),
                                                comment.private ? 'Everyone with access sees this comment again.' : 'Only admins and the author see this comment now.')}>
                                            {comment.private ? <LockOpenIcon /> : <LockIcon />}
                                            {comment.private ? 'Make public' : 'Make private'}
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuGroup>
                                {permissions.delete && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
                                            <Trash2Icon />
                                            Delete
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                <div className="flex min-w-0 flex-col gap-2 sm:pl-9">
                    {comment.quotedText && (
                        <blockquote className="m-0 line-clamp-3 border-l-2 border-muted-foreground/40 pl-3 text-sm text-secondary-foreground">
                            {comment.quotedText}
                        </blockquote>
                    )}
                    {comment.deleted
                        ? <p className="m-0 text-sm text-muted-foreground">Comment deleted</p>
                        : <p className="m-0 text-sm leading-6 break-words whitespace-pre-wrap">{comment.text}{comment.edited && <span className="text-muted-foreground"> (edited)</span>}</p>}

                    {comment.screenshot && (
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button variant="ghost" className="h-auto w-24 self-start p-0" aria-label="Screenshot of the commented part of the page">
                                    <img src={comment.screenshot.url} width={comment.screenshot.width} height={comment.screenshot.height}
                                        alt="Screenshot of the commented part of the page" loading="lazy"
                                        className="block h-16 w-24 rounded-lg border object-contain" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-4xl" aria-describedby={undefined}>
                                <DialogHeader><DialogTitle>Screenshot</DialogTitle></DialogHeader>
                                <img src={comment.screenshot.url} width={comment.screenshot.width} height={comment.screenshot.height}
                                    alt="Expanded screenshot" className="max-h-[70dvh] w-full object-contain" />
                            </DialogContent>
                        </Dialog>
                    )}

                    <NotificationControls projectId={projectId} threadId={comment.id} following={comment.following} />
                    <CommentReproduction context={comment.reproduction} />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 text-sm">
                        <StateBadge resolved={comment.resolved} />
                        {comment.activity?.unread && (
                            <Button size="sm" variant="ghost" disabled={pending}
                                className="text-[hsl(var(--brand-accent-text))]"
                                onClick={() => run(() => markCommentReadAction(projectId, comment.id, comment.activity!.sequence))}>
                                Mark as read
                            </Button>
                        )}
                        {comment.number !== undefined && (
                            <span className="font-mono text-[13px] text-muted-foreground tabular-nums">
                                <span className="sr-only">Comment </span>#{comment.number}
                            </span>
                        )}
                        {comment.kind !== 'comment' && <Badge variant="secondary">{kindLabels[comment.kind]}</Badge>}
                        {comment.private && (
                            <Badge variant="secondary">
                                <LockIcon aria-hidden="true" data-icon="inline-start" />
                                Private
                            </Badge>
                        )}
                        <a
                            href={reviewLink}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-[13px] text-muted-foreground hover:text-foreground hover:underline">
                            <span className="truncate">{comment.url.replace(/^https?:\/\//, '')}</span>
                            <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
                        </a>
                        {comment.assignee
                            ? (
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    Assignee
                                    <span className="text-foreground">{comment.assignee.name}</span>
                                </span>
                            )
                            : <span className="text-muted-foreground">Unassigned</span>}
                    </div>
                </div>
            </div>

            {comment.replies.length > 0 && (
                <Collapsible className="border-t bg-muted/40 px-4 py-2 sm:pl-13">
                    <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="xs" className="group/replies -ml-2 text-muted-foreground">
                            <span className="group-data-open/replies:hidden">{comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}</span>
                            <span className="hidden group-data-open/replies:inline">Hide replies</span>
                            <ChevronDownIcon data-icon="inline-end" className="transition-transform group-data-open/replies:rotate-180" />
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <ol className="m-0 flex list-none flex-col gap-3 py-2 pl-0">
                            {comment.replies.map(reply => (
                                <li key={reply.id} className="flex gap-2.5 text-sm">
                                    <Avatar size="sm" aria-hidden="true">
                                        <AvatarFallback>{initials(reply.author.isMe ? 'You' : reply.author.name)}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <span className="flex flex-wrap items-baseline gap-x-2">
                                            <span className="font-medium">{reply.author.isMe ? 'You' : reply.author.name}</span>
                                            <span className="text-xs text-muted-foreground"><DateTime value={reply.createdAt} /></span>
                                        </span>
                                        <span className="break-words whitespace-pre-wrap">{reply.text}{reply.edited && <span className="text-muted-foreground"> (edited)</span>}</span>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </CollapsibleContent>
                </Collapsible>
            )}

            <Dialog open={editing} onOpenChange={setEditing}>
                <DialogContent>
                    <form
                        className="flex flex-col gap-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            saveEdit();
                        }}>
                        <DialogHeader>
                            <DialogTitle>Edit comment</DialogTitle>
                            <DialogDescription>Everyone who can see the comment sees the new text, marked as edited.</DialogDescription>
                        </DialogHeader>
                        <Field data-invalid={editError ? true : undefined}>
                            <FieldLabel htmlFor={`edit-${comment.id}`}>Text</FieldLabel>
                            <Textarea
                                id={`edit-${comment.id}`}
                                value={editText}
                                onChange={(event) => setEditText(event.target.value)}
                                rows={5}
                                maxLength={maxTextLength}
                                aria-invalid={editError ? true : undefined}
                                className="min-h-28" />
                            {editError && <FieldError>{editError}</FieldError>}
                        </Field>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button type="button" variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button type="submit" disabled={pending}>
                                {pending && <Spinner data-icon="inline-start" />}
                                Save
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {comment.replies.length
                                ? `The comment and its ${comment.replies.length} ${comment.replies.length === 1 ? 'reply are' : 'replies are'} deleted for everyone.`
                                : 'The comment is deleted for everyone.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => run(() => deleteCommentAction(projectId, comment.id), 'Comment deleted.')}>
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}
