'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type RefObject } from 'react';
import { ArrowUpRightIcon, GitPullRequestIcon, PlusIcon, XIcon } from 'lucide-react';
import { useActionState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { setCommentPullRequestAction } from './actions';
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { cn } from '@/src/lib/utils';
import { threadPullRequestLinks, type PullRequestLink, type PullRequestState, type PullRequestStatus } from '@/src/lib/comments/pullRequestLinks';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';
import { integrationLogos } from '../integrations/IntegrationLogo';
import { hoverPopoverTrigger } from '../hoverPopover';
import { withSubject } from './AssigneeCard';
import { unsetValueClass } from './unsetValue';
import { PullRequestStateBadge } from './PullRequestStateBadge';

export const commentPullRequestLinks = (comment: Pick<ProjectCommentView, 'text' | 'deleted' | 'replies' | 'pullRequests'>) =>
    threadPullRequestLinks([{ text: comment.text, deleted: comment.deleted }, ...comment.replies], comment.pullRequests);

const pullRequestLabels: Record<PullRequestState, string> = { open: 'Open', merged: 'Merged', closed: 'Closed', draft: 'Draft' };

const providers = { github: 'GitHub', gitlab: 'GitLab', 'azure-devops': 'Azure DevOps' };
/** The same colours for the pull request's icon once its state is known (at least 3:1 on its surface) */
const stateIconColors: Record<PullRequestState, string> = {
    open: 'text-[hsl(var(--brand-success))]',
    merged: 'text-[hsl(var(--brand-ready))]',
    closed: 'text-destructive',
    draft: 'text-muted-foreground'
};
/**
 * And for its name (at least 4.5:1): Closed's red is 4.1:1 on dark, so a closed pull request's name stays in ink and its
 * icon says it.
 */
const stateTextColors: Record<PullRequestState, string> = { ...stateIconColors, closed: 'text-foreground' };

/** Simple Icons (CC0); GitLab is not an integration, so its mark lives here. Monochrome marks draw in the text colour. */
const gitlabLogo = { viewBox: '0 0 24 24', paths: [{ fill: undefined as string | undefined, d: 'm23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z' }] };
const providerLogos = { github: integrationLogos.github, gitlab: gitlabLogo, 'azure-devops': integrationLogos['azure-devops'] };

function ProviderMark({ provider, className }: { provider: PullRequestLink['provider']; className?: string }) {
    const logo = providerLogos[provider];
    return (
        <svg aria-hidden="true" data-provider-mark={provider} viewBox={logo.viewBox} className={cn('shrink-0 text-foreground', className)} focusable="false">
            {logo.paths.map(path => <path key={path.d} d={path.d} fill={path.fill ?? 'currentColor'} />)}
        </svg>
    );
}

/** "GitHub acme/site #2", "GitLab acme/site !4" */
const pullRequestName = (link: PullRequestLink) => {
    const repository = link.provider === 'azure-devops' ? `${link.organization}/${link.project}/${link.repository}` : link.repository;
    return `${providers[link.provider]} ${repository}${link.provider === 'gitlab' ? ' !' : ' #'}${link.number}`;
};

/** What the last read said, per thread and revision, so the row's card and the details share one recent read. */
const recentStates = new Map<string, { at: number; states: PullRequestStatus[] }>();
const recentListeners = new Set<() => void>();
const rememberStates = (key: string, value: { at: number; states: PullRequestStatus[] }) => {
    recentStates.set(key, value);
    recentListeners.forEach(listener => listener());
};
const subscribeRecent = (listener: () => void) => { recentListeners.add(listener); return () => { recentListeners.delete(listener); }; };
const refreshEvery = 5 * 60_000;
const statesKey = (projectId: string, commentId: string, revision: string, links: PullRequestLink[]) =>
    `${projectId}\n${commentId}\n${revision}\n${links.map(link => link.url).join('\n')}`;

/**
 * The one state all of a thread's pull requests share, from a read the page already made (the open thread or the
 * mark's card); the mark never reads on its own, so rows don't spend the providers' hourly reads.
 */
function useKnownState(key: string, links: PullRequestLink[]) {
    const states = useSyncExternalStore(subscribeRecent, () => recentStates.get(key)?.states, () => undefined);
    const known = links.map(link => states?.find(value => value.url === link.url)?.state);
    return known.length > 0 && known.every(state => state && state === known[0]) ? known[0] : undefined;
}

/**
 * The links' known states. Reads happen only while `element` is on screen in a visible tab, on showing it and every
 * five minutes; a read in the last five minutes for the same thread revision is reused.
 */
function usePullRequestStates(element: RefObject<HTMLElement | null>, projectId: string, commentId: string, links: PullRequestLink[], revision: string) {
    const key = statesKey(projectId, commentId, revision, links);
    const [states, setStates] = useState<PullRequestStatus[]>(() => recentStates.get(key)?.states ?? []);
    useEffect(() => {
        let cancelled = false;
        let shown = false;
        let busy = false;
        let lastRead = recentStates.get(key)?.at ?? 0;
        const controller = new AbortController();
        const refresh = async () => {
            if (cancelled || busy || !shown || document.visibilityState !== 'visible' || Date.now() - lastRead < refreshEvery) return;
            busy = true;
            lastRead = Date.now();
            try {
                const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}/pull-requests`, {
                    cache: 'no-store', credentials: 'same-origin', signal: controller.signal
                });
                const result = response.ok ? await response.json() as PullRequestStatus[] : [];
                if (response.ok) rememberStates(key, { at: lastRead, states: result });
                if (!cancelled) setStates(result);
            } catch { if (!cancelled) setStates([]); }
            finally { busy = false; }
        };
        // The inbox also mounts a thread hidden by CSS on phones. Only the visible detail can trigger a read.
        const observer = new IntersectionObserver(entries => {
            shown = entries.some(entry => entry.isIntersecting);
            void refresh();
        });
        if (element.current) observer.observe(element.current);
        const timer = setInterval(() => void refresh(), refreshEvery);
        document.addEventListener('visibilitychange', refresh);
        return () => { cancelled = true; controller.abort(); observer.disconnect(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [element, key, projectId, commentId]);
    return states;
}

function PullRequestValues({ projectId, commentId, links, revision, comment }: {
    projectId: string; commentId: string; links: PullRequestLink[]; revision: string; comment: ProjectCommentView;
}) {
    const { t } = useAppI18n();
    const value = useRef<HTMLElement>(null);
    const states = usePullRequestStates(value, projectId, commentId, links, revision);
    return (
        <dd ref={value} className="m-0 flex min-h-8 min-w-0 flex-col items-start pointer-coarse:min-h-11" data-pull-request-links>
            {links.map(link => {
                const state = states.find(value => value.url === link.url)?.state;
                return (
                    <div key={link.url} className="flex min-h-8 max-w-full items-center gap-2 pointer-coarse:min-h-11">
                        <a href={link.url} target="_blank" rel="noopener noreferrer"
                            // The state's colour (as on its badge) for the icon and the name once it is known
                            className={cn('-mx-1 inline-flex min-h-8 min-w-0 items-center gap-1 rounded-md px-1 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11', state && stateTextColors[state])}
                            data-pull-request-color={state}>
                            <GitPullRequestIcon aria-hidden="true" className={cn('size-3.5 shrink-0', state ? stateIconColors[state] : 'text-muted-foreground')} />
                            <span className="truncate">{pullRequestName(link)}</span>
                            <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                        </a>
                        {state && <PullRequestStateBadge state={state} label={t(pullRequestLabels[state])} />}
                        {comment.pullRequests?.some(saved => saved.url.toLowerCase() === link.url.toLowerCase() && saved.canRemove) &&
                            <RemovePullRequest projectId={projectId} commentId={commentId} url={link.url} name={pullRequestName(link)} />}
                    </div>
                );
            })}
            {/* One row tall like the links above, so the control is centred on the label */}
            {comment.permissions.triage && <div className="flex min-h-8 w-full min-w-0 items-center pointer-coarse:min-h-11">
                <LinkPullRequest projectId={projectId} commentId={commentId} />
            </div>}
        </dd>
    );
}

/** One properties row; no extra control or tab stop in a list/board card. */
export function ThreadPullRequests({ projectId, comment }: { projectId: string; comment: ProjectCommentView }) {
    const { t } = useAppI18n();
    const links = commentPullRequestLinks(comment);
    if (!links.length && !comment.permissions.triage) return null;
    return <>
        <dt className="flex h-8 items-center text-muted-foreground pointer-coarse:h-11">{t("Pull requests")}</dt>
        <PullRequestValues key={`${projectId}:${comment.id}:${links.map(link => link.url).join('\n')}`} projectId={projectId} commentId={comment.id} links={links} revision={comment.revision} comment={comment} />
    </>;
}

/**
 * A quiet "Link a pull request" control, like the Assignees row's Unassigned: an icon and muted text, no outline.
 * Choosing it shows the URL field with focus in it; Escape or leaving it empty closes it and gives focus back.
 */
function LinkPullRequest({ projectId, commentId }: { projectId: string; commentId: string }) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState('');
    const trigger = useRef<HTMLButtonElement>(null);
    const field = useRef<HTMLInputElement>(null);
    // Focus goes back to the trigger after Escape or a saved link, not when the field is left by clicking elsewhere
    const refocus = useRef(false);
    const [error, setError] = useState<string>();
    const close = (focusTrigger: boolean) => { refocus.current = focusTrigger; setUrl(''); setError(undefined); setOpen(false); };
    const [, action, pending] = useActionState(async () => {
        const result = await setCommentPullRequestAction(projectId, commentId, url);
        if (result?.ok) close(true);
        else if (result) setError(result.error);
        return result;
    }, undefined);
    useEffect(() => {
        if (open) field.current?.focus();
        else if (refocus.current) { refocus.current = false; trigger.current?.focus(); }
    }, [open]);

    if (!open) return (
        <Button ref={trigger} type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}
            data-unset="" className={cn('-ml-1.5 h-7 min-w-0 gap-1.5 px-1.5 font-normal pointer-coarse:min-h-11', unsetValueClass)}>
            <PlusIcon aria-hidden="true" data-icon="inline-start" />
            {t("Link a pull request")}
        </Button>
    );
    return <form action={action} className="flex w-full min-w-0 flex-wrap items-center gap-2"
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }}>
        <Input ref={field} aria-label={t("Pull request URL")} type="url" placeholder={t("Paste a pull request URL")} required maxLength={2048}
            value={url} onChange={event => setUrl(event.target.value)}
            onBlur={event => { if (!url && !event.currentTarget.form?.contains(event.relatedTarget)) close(false); }}
            className="min-w-0 flex-1 pointer-coarse:min-h-11" />
        <Button type="submit" size="sm" variant="ghost" disabled={pending} className="pointer-coarse:min-h-11">{t("Link")}</Button>
        {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
    </form>;
}

/** A small x icon button beside a manual link; its name and tooltip say which link it removes */
function RemovePullRequest({ projectId, commentId, url, name }: { projectId: string; commentId: string; url: string; name: string }) {
    const { t } = useAppI18n();
    const [, action, pending] = useActionState(async () => {
        const result = await setCommentPullRequestAction(projectId, commentId, url, true);
        if (result && !result.ok) toast.error(result.error);
        return result;
    }, undefined);
    const label = t("Remove link to {value0}", { value0: name });
    return <form action={action} className="flex">
        <Tooltip>
            <TooltipTrigger render={<Button type="submit" variant="ghost" size="icon-xs" disabled={pending} aria-label={label}
                className="text-muted-foreground hover:text-foreground pointer-coarse:size-11" />}>
                <XIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    </form>;
}

function PullRequestCardList({ projectId, commentId, links, revision }: {
    projectId: string; commentId: string; links: PullRequestLink[]; revision: string;
}) {
    const { t } = useAppI18n();
    const list = useRef<HTMLUListElement>(null);
    const states = usePullRequestStates(list, projectId, commentId, links, revision);
    return (
        <ul ref={list} className="m-0 flex list-none flex-col gap-1 p-0" data-pull-request-card>
            {links.map(link => {
                const state = states.find(value => value.url === link.url)?.state;
                return (
                    <li key={link.url} className="min-w-0">
                        <Item size="xs" render={<a href={link.url} target="_blank" rel="noopener noreferrer" />}
                            className="flex-nowrap pointer-coarse:min-h-11">
                            <ItemMedia variant="icon"><ProviderMark provider={link.provider} className="size-4" /></ItemMedia>
                            <ItemContent className="min-w-0">
                                <ItemTitle className={cn('block max-w-full truncate', state && stateTextColors[state])} data-pull-request-color={state}
                                    title={pullRequestName(link)}>{pullRequestName(link)}</ItemTitle>
                            </ItemContent>
                            {state && <PullRequestStateBadge state={state} label={t(pullRequestLabels[state])} />}
                            <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                        </Item>
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * The "Linked pull request" mark on a row or board card. Hovering it shows the thread's pull requests: the provider's
 * mark, repository and number as a link, and the state when known (read only while the card is open). A mouse click
 * still opens the thread (`onPress`, the row's link); the keyboard (Enter on the focused mark) and a tap open the card.
 * Provider titles are never read (see integrations.md), so none shows.
 */
export function PullRequestCard({ projectId, comment, links, subject, tabbable = true, onPress }: {
    projectId: string;
    /** Which thread the mark belongs to, after its name ("comment #12"): every row has one, so the names tell them apart */
    subject?: string;
    comment: Pick<ProjectCommentView, 'id' | 'revision'>;
    links: PullRequestLink[];
    tabbable?: boolean;
    onPress?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    const pointer = useRef<string>('');
    const popup = useRef<HTMLDivElement>(null);
    const state = useKnownState(statesKey(projectId, comment.id, comment.revision, links), links);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger {...hoverPopoverTrigger} delay={200} data-pull-request-mark="" aria-label={withSubject(t("Linked pull request"), subject)} tabIndex={tabbable ? undefined : -1}
                onPointerDown={event => { pointer.current = event.pointerType; }}
                onClick={event => {
                    // Keyboard clicks have no detail; a tap has no hover to show the card
                    if (event.detail === 0 || pointer.current === 'touch' || !onPress) return;
                    event.preventBaseUIHandler();
                    setOpen(false);
                    onPress(event);
                }}
                // Above the row's link; on a touch screen the tap target reaches 44px around the 14px mark
                data-pull-request-color={state}
                className={cn('relative z-10 -m-1 flex shrink-0 rounded-sm p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:-m-3.5 pointer-coarse:p-3.5',
                    state ? stateIconColors[state] : 'hover:text-foreground')}>
                <GitPullRequestIcon aria-hidden="true" className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent ref={popup} initialFocus={popup} align="end" aria-label={t("Pull requests")} className="max-h-[min(32rem,80dvh)] w-80 max-w-[calc(100vw-2rem)] gap-1 overflow-y-auto p-1.5">
                <PullRequestCardList projectId={projectId} commentId={comment.id} links={links} revision={comment.revision} />
            </PopoverContent>
        </Popover>
    );
}
