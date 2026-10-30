'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    ArrowUpRightIcon,
    BugIcon,
    CheckIcon,
    ChevronDownIcon,
    FileIcon,
    HeartIcon,
    Link2Icon,
    LockIcon,
    LockOpenIcon,
    MailCheckIcon,
    MoreHorizontalIcon,
    PencilIcon,
    ReplaceIcon,
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
import { Avatar, AvatarFallback } from '@/src/components/ui/avatar';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
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
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { Field, FieldError, FieldLabel } from '@/src/components/ui/field';
import { Spinner } from '@/src/components/ui/spinner';
import { Textarea } from '@/src/components/ui/textarea';
import type { ProjectCommentMessage, ProjectCommentView } from '../../../lib/app/projectComments';
import type { ActionState } from '../../../lib/app/actionResult';
import type { DbCommentKind } from '../../../lib/db/schema';
import { initials } from '../initials';
import { RelativeTime } from './DateTime';
import { CommentDevice } from './CommentDevice';
import { NotificationControls } from './NotificationControls';
import { CopyIssueButton, CopyIssueResult, useCopyIssue } from './CopyIssue';
import { ThreadAction } from './ThreadAction';
import { integrationLabels, kindLabels } from './commentLabels';
import {
    markCommentReadAction,
    deleteCommentAction,
    deleteCommentReplyAction,
    filterCommentAuthorAction,
    editCommentAction,
    setCommentAssigneeAction,
    setCommentPrivateAction,
    setCommentResolvedAction
} from './actions';

export type AssigneeOption = { userId: string; name: string };

/** A card leaving its list after Done or Reopen: the exit animation, and undoing it when the change fails */
export type ResolveExit = { finished: Promise<void>; cancel: () => void };

const kindIcons = { feedback: HeartIcon, bug: BugIcon, rewrite: ReplaceIcon } as const;

const maxTextLength = 1000;

/** Open: ink dot; done: green (BRAND.md, "Components": badges with a status dot). The toolbar's `CommentStatusBadge`. */
function StateDot({ resolved }: { resolved: boolean }) {
    return <span aria-hidden="true" className={resolved ? 'size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-success))]' : 'size-1.5 shrink-0 rounded-full bg-foreground'} />;
}

function StateBadge({ resolved }: { resolved: boolean }) {
    return (
        <Badge variant="outline" className="gap-1.5">
            <StateDot resolved={resolved} />
            <span className="sr-only">Status: </span>
            {resolved ? 'Done' : 'Open'}
        </Badge>
    );
}

/** The status badge as a menu, for those who can mark the comment done or reopen it */
function StateMenu({ resolved, disabled, onChange }: { resolved: boolean; disabled: boolean; onChange: () => void }) {
    const state = resolved ? 'Done' : 'Open';
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="xs" disabled={disabled} aria-label={`Status: ${state}. Change status`}
                    className="h-5 gap-1.5 rounded-4xl pl-2 pointer-coarse:min-h-11">
                    <StateDot resolved={resolved} />
                    {state}
                    <ChevronDownIcon aria-hidden="true" data-icon="inline-end" className="text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36">
                <DropdownMenuGroup>
                    {[false, true].map(option => (
                        <DropdownMenuItem key={String(option)} onSelect={() => option !== resolved && onChange()}>
                            <StateDot resolved={option} />
                            {option ? 'Done' : 'Open'}
                            {option === resolved && <CheckIcon className="ml-auto" />}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** The blue dot of a thread with activity the reader has not read (the toolbar's `UnreadDot`) */
function UnreadDot() {
    return (
        <span title="Unread" className="inline-flex shrink-0 items-center">
            <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />
            <span className="sr-only">Unread</span>
        </span>
    );
}

/** "Feedback", "Bug report" or "Suggested rewrite" above the first message, as in the toolbar */
function KindLabel({ kind }: { kind: DbCommentKind }) {
    if (kind === 'comment')
        return null;
    const Icon = kindIcons[kind];
    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-secondary-foreground">
            <Icon aria-hidden="true" className="size-3.5" />
            {kindLabels[kind]}
        </span>
    );
}

/** One message of the thread: the avatar makes the column, as in the toolbar's thread */
function Message({ author, createdAt, meta, actions, children }: {
    author: string;
    createdAt?: string;
    /** After the time: the screen and browser the comment was left from */
    meta?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex gap-2.5">
            <Avatar size="sm" aria-hidden="true" className="mt-0.5">
                <AvatarFallback className="font-semibold text-foreground">{initials(author)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-h-7 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="truncate font-medium">{author}</span>
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

/** The text of a message, "(edited)" after it as in the toolbar */
function MessageText({ text, edited }: { text: string; edited: boolean }) {
    return <p className="m-0 text-sm leading-6 break-words whitespace-pre-wrap">{text}{edited && <span className="text-muted-foreground"> (edited)</span>}</p>;
}

/**
 * A project comment in the app's list and board, laid out like the toolbar's thread: status, number
 * and actions on top, then who it is assigned to and where it came from, the messages, the quiet
 * thread actions, and the page it was left on at the bottom
 */
export function CommentCard({ projectId, comment, reviewLink, assignees, userId, onResolve }: {
    projectId: string;
    comment: ProjectCommentView;
    /** Review link that opens the page at this comment */
    reviewLink: string;
    assignees: AssigneeOption[];
    /** The signed-in user: "Assigned to you" */
    userId: string;
    /** Done or Reopen takes the comment out of its list: starts its exit right away */
    onResolve?: (resolved: boolean) => ResolveExit;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [pending, startTransition] = useTransition();
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState(comment.text);
    const [editError, setEditError] = useState<string>();
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const copyIssue = useCopyIssue(projectId, comment.id);
    const [confirmingReply, setConfirmingReply] = useState<string>();
    const [expanded, setExpanded] = useState(false);
    const firstRevealedRef = useRef<HTMLLIElement>(null);
    const { permissions, source } = comment;
    const author = comment.author.isMe ? 'You' : comment.author.name;
    const label = comment.deleted ? 'Deleted comment' : `Comment by ${comment.author.isMe ? 'you' : comment.author.name}`;
    const unread = Boolean(comment.activity?.unread);
    const assigned = comment.assignee
        ? `Assigned to ${comment.assignee.id === userId ? 'you' : comment.assignee.name}`
        : 'Unassigned';
    // In the footer, after the page link: the environment's name; the address itself is in the link
    const sourceText = source.available
        ? source.label !== source.origin ? source.label : undefined
        : `${source.label}${source.origin && source.origin !== source.label ? ` · ${source.origin}` : ''} · Original source unavailable`;

    // First and last message; "Show all" for the ones between (the toolbar's thread)
    const lastReply = comment.replies.at(-1);
    const hiddenReplies = comment.replies.slice(0, -1);
    const messagesCount = [!comment.deleted, ...comment.replies.map(reply => !reply.deleted)].filter(Boolean).length;
    useEffect(() => {
        if (expanded)
            firstRevealedRef.current?.focus();
    }, [expanded]);

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

    const toggleResolved = () => startTransition(async () => {
        const resolved = !comment.resolved;
        const exit = onResolve?.(resolved);
        // The refresh removes the card only once its exit has played
        const [result] = await Promise.all([setCommentResolvedAction(projectId, comment.id, resolved), exit?.finished]);
        if (result && !result.ok) {
            exit?.cancel();
            toast.error(result.error);
            return;
        }
        router.refresh();
    });

    const filterAuthor = (itemId?: string) => startTransition(async () => {
        const result = await filterCommentAuthorAction(projectId, comment.id, itemId);
        if (!result?.ok) {
            toast.error(result?.error ?? 'Could not filter by this author.');
            return;
        }
        const params = new URLSearchParams(searchParams.toString());
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

    const saveEdit = () => startTransition(async () => {
        const result = await editCommentAction(projectId, comment.id, editText);
        if (result && !result.ok) {
            setEditError(result.error);
            return;
        }
        setEditing(false);
        router.refresh();
    });

    const reply = (item: ProjectCommentMessage) => {
        const name = item.author.isMe ? 'You' : item.author.name;
        return (
            <Message author={name} createdAt={item.createdAt}
                actions={!item.deleted && (item.canDelete || item.canFilterAuthor) && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs" disabled={pending} className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                                aria-label={`More actions for reply by ${item.author.isMe ? 'you' : item.author.name}`}>
                                <MoreHorizontalIcon />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                                {item.canFilterAuthor && (
                                    <DropdownMenuItem onSelect={() => filterAuthor(item.id)}>
                                        <UserIcon />
                                        More from this author
                                    </DropdownMenuItem>
                                )}
                                {item.canDelete && (
                                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingReply(item.id)}>
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
                    : <MessageText text={item.text} edited={item.edited} />}
            </Message>
        );
    };

    return (
        <Card role="article" aria-label={label} className="@container/comment gap-0 py-0">
            <div className="flex flex-col gap-3 px-4 py-3">
                {/* The toolbar's thread header: status, public id and unread dot, then the actions
                    (on a line of their own in a narrow board column) */}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <div className="flex min-w-0 items-center gap-2">
                        {permissions.resolve
                            ? <StateMenu resolved={comment.resolved} disabled={pending} onChange={toggleResolved} />
                            : <StateBadge resolved={comment.resolved} />}
                        {comment.number !== undefined && (
                            <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                <span className="sr-only">Comment </span>#{comment.number}
                            </span>
                        )}
                        {unread && <UnreadDot />}
                        {comment.private && (
                            <Badge variant="secondary">
                                <LockIcon aria-hidden="true" data-icon="inline-start" />
                                Private
                            </Badge>
                        )}
                    </div>
                    <div className="-mr-1.5 ml-auto flex shrink-0 items-center gap-0.5">
                        {unread && (
                            <ThreadAction label="Mark as read" disabled={pending}
                                onClick={() => run(() => markCommentReadAction(projectId, comment.id, comment.activity!.sequence))}>
                                <MailCheckIcon />
                            </ThreadAction>
                        )}
                        <CopyIssueButton state={copyIssue} />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`More actions for the ${label.toLowerCase()}`}
                                    className="text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                                    {pending ? <Spinner /> : <MoreHorizontalIcon />}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-48">
                                <DropdownMenuGroup>
                                    <DropdownMenuItem disabled={!source.available} onSelect={copyLink}>
                                        <Link2Icon />
                                        {source.available ? 'Copy link' : 'Copy link (original source unavailable)'}
                                    </DropdownMenuItem>
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
                                    {comment.canFilterAuthor && (
                                        <DropdownMenuItem onSelect={() => filterAuthor()}>
                                            <UserIcon />
                                            More from this author
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
                <CopyIssueResult state={copyIssue} />

                {/* Who it is assigned to (the list of people for those who can assign) */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {permissions.assign ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="xs" disabled={pending} aria-label={`${assigned}. Change assignee`}
                                    className="-ml-2 font-normal text-muted-foreground hover:text-foreground pointer-coarse:min-h-11">
                                    <UserIcon aria-hidden="true" data-icon="inline-start" />
                                    {assigned}
                                    <ChevronDownIcon aria-hidden="true" data-icon="inline-end" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto">
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Assign to</DropdownMenuLabel>
                                    {assignees.filter(option => comment.eligibleAssigneeIds.includes(option.userId)).map(option => (
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
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <span className="inline-flex min-h-6 items-center gap-1">
                            <UserIcon aria-hidden="true" className="size-3 shrink-0" />
                            {assigned}
                        </span>
                    )}
                </div>

                {/* The messages, one under the other like a chat */}
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                    <li>
                        <Message author={comment.deleted ? 'Deleted' : author} createdAt={comment.createdAt}
                            meta={<CommentDevice device={comment.device} context={comment.reproduction} />}>
                            <KindLabel kind={comment.kind} />
                            {comment.quotedText && (
                                <blockquote className="m-0 line-clamp-4 border-l-2 border-border pl-2.5 text-sm text-secondary-foreground">
                                    {comment.quotedText}
                                </blockquote>
                            )}
                            {comment.deleted
                                ? <p className="m-0 text-sm text-muted-foreground">Comment deleted</p>
                                : <MessageText text={comment.displayText} edited={comment.edited} />}
                            {comment.screenshot && (
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button variant="ghost" className="mt-1 h-auto w-24 self-start p-0" aria-label="Screenshot of the commented part of the page">
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
                        </Message>
                    </li>
                    {expanded && hiddenReplies.map((item, index) => (
                        <li key={item.id} ref={index === 0 ? firstRevealedRef : undefined} tabIndex={index === 0 ? -1 : undefined}
                            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {reply(item)}
                        </li>
                    ))}
                    {!expanded && hiddenReplies.length > 0 && (
                        <li>
                            <Button variant="ghost" size="xs" className="ml-7 text-muted-foreground" onClick={() => setExpanded(true)}>
                                Show all {messagesCount} messages
                            </Button>
                        </li>
                    )}
                    {lastReply && <li>{reply(lastReply)}</li>}
                </ol>

                {/* Quiet thread actions, as in the toolbar */}
                <div className="-ml-2 flex flex-wrap items-center gap-x-1 gap-y-1">
                    <NotificationControls projectId={projectId} threadId={comment.id} following={comment.following} />
                    {comment.integrationLinks?.map(link => (
                        <a key={link.provider} href={link.url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex min-h-6 items-center px-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground pointer-coarse:min-h-11">
                            Open in {integrationLabels[link.provider] ?? link.provider}
                        </a>
                    ))}
                </div>
            </div>

            {/* The page it was left on, like the toolbar inbox's card footer, and where it came from */}
            <div className="flex min-w-0 items-center gap-2 border-t px-2 py-1">
                {source.available ? (
                    <a href={reviewLink} target="_blank" rel="noopener"
                        className="flex min-w-0 items-center gap-1.5 rounded-md p-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11">
                        <span className="sr-only">Open on </span>
                        <FileIcon aria-hidden="true" className="size-3.5 shrink-0" />
                        <span className="truncate font-mono">{comment.url.replace(/^https?:\/\//, '')}</span>
                        <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    </a>
                ) : (
                    <p className="m-0 flex min-w-0 items-center gap-1.5 p-2 text-xs text-muted-foreground">
                        <FileIcon aria-hidden="true" className="size-3.5 shrink-0" />
                        <span className="truncate font-mono">{comment.path}</span>
                    </p>
                )}
                {sourceText && <span className="ml-auto min-w-0 shrink-0 truncate pr-2 text-xs text-muted-foreground">{sourceText}</span>}
            </div>

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
