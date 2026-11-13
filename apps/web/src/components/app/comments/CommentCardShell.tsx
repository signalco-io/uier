'use client';

import { Fragment, useRef, type CSSProperties } from 'react';
import { ArrowLeftIcon, MoreHorizontalIcon, ReplyIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Card, CardFooter } from '@/src/components/ui/card';
import { Skeleton } from '@/src/components/ui/skeleton';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';
import { decodeAnchor, decodeMessage, decodeReplies, type OutlineMessage } from '@/src/lib/app/commentOutline';
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

/** Words of a typical width, shaped to a line's length: the shell's text wraps about where the loaded text does */
const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
const fill = (length: number) => filler.repeat(Math.ceil(length / filler.length)).slice(0, length);

/** Transparent filler text on pulsing bars, one bar per wrapped line (its words keep the line breaks where they fall) */
function Bars({ length }: { length: number }) {
    return <span className="rounded-sm bg-muted text-transparent select-none [box-decoration-break:clone] animate-pulse motion-reduce:animate-none">{fill(length)}</span>;
}

/**
 * A message's text still loading, from its lines' lengths (`commentOutline.ts`): `MessageMarkdown`'s paragraphs, 24 px a line, a blank
 * line between paragraphs, each line as long as the loaded one. Markdown that is not a paragraph (lists, code) takes
 * about the same room.
 */
function TextSkeleton({ lines }: { lines: number[] }) {
    const paragraphs: number[][] = [];
    let current: number[] | undefined;
    for (const length of lines) {
        if (!length) current = undefined;
        else if (current) current.push(length);
        else paragraphs.push(current = [length]);
    }
    if (!paragraphs.length) return null;
    return (
        <div aria-hidden="true" className="flex min-w-0 flex-col gap-2 text-sm leading-6 [overflow-wrap:anywhere]">
            {paragraphs.map((paragraph, index) => (
                <p key={index} className="m-0 whitespace-pre-wrap">
                    {paragraph.map((length, line) => <Fragment key={line}>{line > 0 && '\n'}<Bars length={length} /></Fragment>)}
                </p>
            ))}
        </div>
    );
}

/** `MessageImage`'s height limit (`max-h-56`), in CSS pixels */
const thumbnailMaxHeight = 224;

/** `MessageImage`'s thumbnail at its final size: its own width or what the height limit allows, narrowed to the column */
function ImageSkeleton({ image }: { image?: { width: number; height: number } }) {
    if (!image || image.width <= 0 || image.height <= 0) return null;
    return <Placeholder className="mt-1 max-w-full self-start rounded-lg border"
        style={{ aspectRatio: `${image.width} / ${image.height}`, width: `${Math.min(image.width, Math.round(thumbnailMaxHeight * image.width / image.height))}px` }} />;
}

/** `ReactionList`'s pills */
function ReactionsSkeleton({ count = 0 }: { count?: number }) {
    if (count <= 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-1 pt-0.5 pointer-coarse:gap-y-3">
            {Array.from({ length: count }, (_, index) => <Placeholder key={index} className="h-6 w-11 rounded-full pointer-coarse:h-8" />)}
        </div>
    );
}

/**
 * One reply as `Message` lays it out: the avatar centred on the header row (44 px on touch screens when it has
 * actions), its text's shape, image and reactions under it
 */
function ReplySkeleton({ reply, actions }: { reply: OutlineMessage; actions: boolean }) {
    const { t } = useAppI18n();
    return (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1">
            <Placeholder className="size-6 self-center rounded-full" />
            <div className={cn('flex min-h-7 items-center gap-2', actions && 'pointer-coarse:min-h-11')}>
                <Placeholder className="h-3.5 w-24" />
                <Placeholder className="h-3 w-12" />
            </div>
            <div className="col-start-2 flex min-w-0 flex-col gap-1">
                {reply.deleted ? <p className="m-0 text-sm text-muted-foreground">{t("Reply deleted")}</p> : <>
                    <TextSkeleton lines={reply.lines} />
                    <ImageSkeleton image={reply.image} />
                    <ReactionsSkeleton count={reply.reactions} />
                </>}
            </div>
        </div>
    );
}

/**
 * The open thread while its canonical detail loads (uier #385), shaped like `CommentCard`. What the list's summary
 * holds is drawn as the card draws it: the status, number, unread dot and Private badge with Copy and More actions, the
 * title, every detail label with Page, On's label, Assignees, Priority, Labels and Pull requests, the first message's
 * author, time and first 500 characters, Reply, Open in ... and Activity. What only the detail has pulses in its place,
 * sized from the summary's `outline` (counts and lengths, never the text): the selector or selected text, the device,
 * the rest of the first message, the screenshot, the reactions and every reply with its text, image and reactions.
 * Text placeholders are filler words as long as each loaded line, so they wrap about where it does: a line can still
 * wrap one word sooner or later, and Markdown other than paragraphs is approximated. The drawn controls are inert
 * until the thread is ready; Back to comments works at once. A failed load says so in the messages' place, with Try again.
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
    const outline = comment.outline;
    const anchor = decodeAnchor(outline?.anchor);
    const selector = anchor.type === 'element' || anchor.type === 'area' ? anchor.size ?? 0 : undefined;
    const selectedText = anchor.type === 'text' ? anchor.size ?? 0 : undefined;
    const replies = decodeReplies(outline?.replies);
    const rest = outline?.rest ? decodeMessage(outline.rest).lines : undefined;
    const [screenshotWidth, screenshotHeight] = (outline?.screenshot ?? '').split('x').map(Number);
    const screenshot = screenshotWidth && screenshotHeight ? { width: screenshotWidth, height: screenshotHeight } : undefined;
    const history = outline?.history ?? 0;
    const status = commentStatus(comment);
    const allowed = allowedStatuses(comment);
    const author = comment.author.isMe ? t("You") : comment.author.name;
    const firstReactions = !comment.deleted && comment.messageId ? outline?.reactions ?? 0 : 0;
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
                        {/* As the card's: the label, then the selector (`SelectorCode`: a long one as its 28-character start and end with
                            Show full selector) or the selected text (four lines at most) as long as the loaded ones */}
                        <dd className="m-0 flex min-h-8 min-w-0 flex-wrap items-baseline gap-x-2 py-1.5 pointer-coarse:min-h-11 pointer-coarse:py-3">
                            {anchor.label ? <span className="min-w-0 break-words">{anchor.label}</span> : <Bars length={12} />}
                            {selector !== undefined && (
                                <span className="min-w-0">
                                    <code className="font-mono text-xs break-all"><Bars length={Math.min(selector, 28)} /></code>
                                    {selector > 28 && <Placeholder className="relative -my-1 ml-1 inline-block size-6 align-middle" />}
                                </span>
                            )}
                            {selectedText !== undefined && (
                                <blockquote className="m-0 mt-1 line-clamp-4 basis-full border-l-2 border-border pl-2.5 text-transparent"><Bars length={selectedText} /></blockquote>
                            )}
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
                                    // Past its first 500 characters (the summary's) the text is still loading; "(edited)" ends that part
                                    : <MessageText text={comment.displayText} mentions={comment.displayMentions} edited={comment.edited && !rest} />}
                                {!comment.deleted && rest && <TextSkeleton lines={rest} />}
                                <ImageSkeleton image={screenshot} />
                                <ReactionsSkeleton count={firstReactions} />
                            </Message>
                        </li>
                        {/* Every reply, as the card shows every one */}
                        {replies.map((reply, index) => (
                            <li key={index}><ReplySkeleton reply={reply} actions={!reply.deleted && Boolean(permissions.react || reply.actions)} /></li>
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
            {history > 0 && (
                <CardFooter inert className="block border-t px-4 [.border-t]:mb-0 [.border-t]:py-2">
                    <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground pointer-coarse:min-h-11">
                        {t("Activity ({count})", { count: history })}
                    </Button>
                </CardFooter>
            )}
        </Card>
    );
}
