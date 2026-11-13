'use client';

import { useRef, type CSSProperties } from 'react';
import { ArrowLeftIcon, MoreHorizontalIcon, ReplyIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Card, CardFooter } from '@/src/components/ui/card';
import { Skeleton } from '@/src/components/ui/skeleton';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';
import { AssigneesControl } from './AssigneesControl';
import { detailLabelClass, detailValueClass, KindLabel, Message, MessageText, PageDetail, PrivateBadge, type AssigneeOption } from './CommentCard';
import { commentStatus, StateBadge, StateMenu } from './CommentStatus';
import { CopyMenu, useCopyIssue } from './CopyIssue';
import { MessageAgent } from './MessageAgent';
import { ReactionPicker } from './MessageReactions';
import { PriorityControl } from './PriorityControl';
import { integrationLabels } from './commentLabels';
import { ThreadLabelsControl } from './ThreadLabelsControl';
import { ThreadPullRequests } from './ThreadPullRequests';
import { ThreadTitle } from './ThreadTitle';
import { allowedStatuses } from './useStatusChange';
import { VerificationControl } from './VerificationControl';

/** A placeholder that pulses while the thread loads, still with reduced motion */
function Placeholder({ className, style }: { className?: string; style?: CSSProperties }) {
    return <Skeleton aria-hidden="true" className={cn('motion-reduce:animate-none', className)} style={style} />;
}

/** A line of text-sm text (20 px) still loading */
function TextLine({ className }: { className?: string }) {
    return <Placeholder className={cn('my-0.5 h-4', className)} />;
}

/** A line of a message's text still loading: its paragraphs are 24 px a line (`MessageMarkdown`) */
function MessageLine({ className }: { className?: string }) {
    return <Placeholder className={cn('my-1 h-4', className)} />;
}

/** The skeleton of one reply as `Message` lays it out: the avatar centred on the header row, the text under it */
function ReplySkeleton({ width }: { width: string }) {
    return (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1">
            <Placeholder className="size-6 self-center rounded-full" />
            <div className="flex min-h-7 items-center gap-2 pointer-coarse:min-h-11">
                <Placeholder className="h-3.5 w-24" />
                <Placeholder className="h-3 w-12" />
            </div>
            <div className="col-start-2 flex min-w-0 flex-col gap-1">
                <MessageLine className={width} />
            </div>
        </div>
    );
}

const replyWidths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6'];
/** Shown reply skeletons at most: a long thread keeps scrolling once it has loaded */
const maxReplySkeletons = 8;
/** `MessageImage`'s height limit (`max-h-56`), in CSS pixels */
const thumbnailMaxHeight = 224;

/**
 * The open thread while its canonical detail loads (uier #385), shaped like `CommentCard` so nothing moves when it
 * arrives. What the list's summary already holds is drawn as the card draws it: the status, number, unread dot and
 * Private badge with Copy and More actions, the title, every detail label with Page, Assignees, Priority, Labels and
 * Pull requests, the first message's author, time and text, Reply, Open in ... and Activity. What only the detail has
 * pulses as skeletons in its place, sized from the summary's `outline`: what it was left on, the device, the
 * screenshot, the reactions and each reply. The drawn controls are inert until the thread is ready; Back to comments
 * works at once. A failed load says so in the messages' place, with Try again.
 */
export function CommentCardShell({ projectId, comment, reviewLink, assignees, userId, onBack, failed = false, onRetry, className }: {
    projectId: string;
    /** The list's summary of the thread */
    comment: ProjectCommentView;
    reviewLink: string;
    assignees: AssigneeOption[];
    userId: string;
    onBack?: () => void;
    failed?: boolean;
    onRetry?: () => void;
    className?: string;
}) {
    const { t } = useAppI18n();
    const copyIssue = useCopyIssue(projectId, comment.id);
    const assigneeTrigger = useRef<HTMLButtonElement>(null);
    const { permissions } = comment;
    const outline = comment.outline ?? { replies: 0, reactions: 0, history: 0, anchor: 'page' as const };
    const status = commentStatus(comment);
    const allowed = allowedStatuses(comment);
    const author = comment.author.isMe ? t("You") : comment.author.name;
    // The summary keeps the first 500 characters of the first message: the rest is still loading
    const truncated = comment.displayText.length >= 500;
    const screenshot = outline.screenshot && outline.screenshot.width > 0 && outline.screenshot.height > 0 ? outline.screenshot : undefined;
    const firstReactions = !comment.deleted && comment.messageId ? outline.reactions : 0;
    return (
        <Card role="status" aria-busy={!failed} data-thread-shell={failed ? 'failed' : 'loading'} className={cn('@container/comment gap-0 py-0', className)}>
            <span className="sr-only">{t("Loading comments")}</span>
            <div className="flex flex-col gap-4 px-4 py-3">
                <div className="flex items-center gap-2">
                    {onBack && (
                        <Button variant="ghost" size="icon-sm" aria-label={t("Back to comments")} onClick={onBack}
                            className="-ml-2 shrink-0 @3xl/comments:hidden pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                            <ArrowLeftIcon />
                        </Button>
                    )}
                    <div inert className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {Object.values(allowed).some(Boolean)
                            ? <StateMenu comment={comment} status={status} allowed={allowed} disabled={false} onChange={() => {}} />
                            : <StateBadge comment={comment} status={status} />}
                        {comment.number !== undefined && (
                            <span className="font-mono text-xs text-muted-foreground tabular-nums">#{comment.number}</span>
                        )}
                        {comment.activity?.unread && (
                            <span className="flex w-3 shrink-0 justify-center">
                                <span className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />
                            </span>
                        )}
                        {comment.archivedAt && <Badge variant="outline" className="text-muted-foreground">{t("Archived")}</Badge>}
                        {comment.private && <PrivateBadge />}
                    </div>
                    <div inert className="-mr-1.5 flex shrink-0 items-center gap-0.5">
                        <CopyMenu copyIssue={copyIssue} canCopyLink={comment.source.available} onCopyLink={() => {}} />
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                            <MoreHorizontalIcon />
                        </Button>
                    </div>
                </div>

                <div inert className="contents">
                    <ThreadTitle projectId={projectId} commentId={comment.id} title={comment.title} byAi={comment.titleByAi} canRename={permissions.title} />
                    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 text-sm">
                        <PageDetail comment={comment} reviewLink={reviewLink} />
                        <dt className={detailLabelClass}>{t("On")}</dt>
                        <dd className="m-0 flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 py-1.5 pointer-coarse:min-h-11 pointer-coarse:py-3">
                            {/* The label and a short selector fit one line on a phone, as `SelectorCode` keeps a long one */}
                            <TextLine className="w-20" />
                            {(outline.anchor === 'element' || outline.anchor === 'area') && <TextLine className="w-24" />}
                            {outline.anchor === 'text' && <Placeholder className="mt-1 h-10 basis-full" />}
                        </dd>
                        <dt className={detailLabelClass}>{t("Assignees")}</dt>
                        <dd className={detailValueClass}>
                            <AssigneesControl projectId={projectId} comment={comment} userId={userId} options={assignees} trigger={assigneeTrigger} />
                        </dd>
                        <dt className={detailLabelClass}>{t("Priority")}</dt>
                        <dd className={detailValueClass}><PriorityControl projectId={projectId} commentId={comment.id} priority={comment.priority} canEdit={permissions.triage} /></dd>
                        <dt className={detailLabelClass}>{t('Labels')}</dt>
                        <dd className={detailValueClass}>
                            {/* The summary has no list of the project's labels: the thread's own stand in, so Edit labels is in its place */}
                            <ThreadLabelsControl projectId={projectId} commentId={comment.id} labels={comment.labels ?? []} available={comment.availableLabels ?? comment.labels ?? []} canEdit={permissions.triage} />
                        </dd>
                        <ThreadPullRequests projectId={projectId} comment={comment} readStates={false} />
                    </dl>
                    <VerificationControl projectId={projectId} userId={userId} comment={comment} formOpen={false} onFormOpenChange={() => {}} />
                </div>

                {failed ? (
                    <div className="flex flex-col items-start gap-2 border-t pt-4">
                        <p role="alert" className="m-0 text-sm text-muted-foreground">{t("This thread could not be loaded.")}</p>
                        <Button variant="outline" onClick={onRetry}>{t("Try again")}</Button>
                    </div>
                ) : (
                    <ol inert className="m-0 flex list-none flex-col gap-3 border-t p-0 pt-4">
                        <li>
                            <Message author={comment.deleted ? t("Deleted") : author} agent={!comment.deleted && <MessageAgent author={comment.author} />}
                                avatarName={comment.author.name} avatarUrl={comment.author.avatarUrl} createdAt={comment.createdAt}
                                // `CommentDevice`'s button: the screen and browser marks wait for the reproduction details
                                meta={<span className="inline-flex h-6 shrink-0 items-center gap-1 px-1.5 pointer-coarse:min-h-11">
                                    {comment.device && <Placeholder className="size-3.5 rounded-full" />}
                                    <Placeholder className="size-3.5 rounded-full" />
                                </span>}
                                actions={!comment.deleted && comment.messageId && permissions.react && <ReactionPicker target={{ projectId, commentId: comment.id, itemId: comment.messageId }} />}>
                                <KindLabel kind={comment.kind} feedbackType={comment.feedbackType} />
                                {comment.deleted
                                    ? <p className="m-0 text-sm text-muted-foreground">{t("Comment deleted")}</p>
                                    : <MessageText text={comment.displayText} mentions={comment.displayMentions} edited={comment.edited} />}
                                {truncated && <MessageLine className="w-2/3" />}
                                {screenshot && (
                                    <Placeholder className="mt-1 max-w-full self-start rounded-lg border"
                                        // `MessageImage`'s thumbnail: its own width or what the height limit allows, narrowed to the column
                                        style={{ aspectRatio: `${screenshot.width} / ${screenshot.height}`, width: `${Math.min(screenshot.width, Math.round(thumbnailMaxHeight * screenshot.width / screenshot.height))}px` }} />
                                )}
                                {firstReactions > 0 && (
                                    <div className="flex flex-wrap items-center gap-1 pt-0.5 pointer-coarse:gap-y-3">
                                        {Array.from({ length: firstReactions }, (_, index) => <Placeholder key={index} className="h-6 w-11 rounded-full pointer-coarse:h-8" />)}
                                    </div>
                                )}
                            </Message>
                        </li>
                        {Array.from({ length: Math.min(outline.replies, maxReplySkeletons) }, (_, index) => (
                            <li key={index}><ReplySkeleton width={replyWidths[index % replyWidths.length]!} /></li>
                        ))}
                    </ol>
                )}

                {(permissions.reply || Boolean(comment.integrationLinks?.length)) && (
                    <div inert className="contents">
                        {permissions.reply && (
                            <Button variant="ghost" size="sm" className="ml-7 self-start text-muted-foreground pointer-coarse:min-h-11">
                                <ReplyIcon data-icon="inline-start" />{t("Reply")}
                            </Button>
                        )}
                        {comment.integrationLinks?.length ? (
                            <div className="-ml-2 flex flex-wrap items-center gap-x-1 gap-y-1">
                                {comment.integrationLinks.map(link => (
                                    <span key={link.provider} className="inline-flex min-h-6 items-center px-2 text-xs text-muted-foreground underline underline-offset-2 pointer-coarse:min-h-11">
                                        {t("Open in ")}{integrationLabels[link.provider] ?? link.provider}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            {/* `ThreadActivity`'s footer, its entries still loading */}
            {outline.history > 0 && (
                <CardFooter inert className="block border-t px-4 [.border-t]:mb-0 [.border-t]:py-2">
                    <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground pointer-coarse:min-h-11">
                        {t("Activity ({count})", { count: outline.history })}
                    </Button>
                </CardFooter>
            )}
        </Card>
    );
}
