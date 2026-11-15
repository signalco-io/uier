import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Logo } from '@uier/brand/Logo';
import type { FeedbackContext } from '@uier/toolbar/feedback-context';
import { ArrowUpRight, RefreshCw, User } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/spinner';
import { AppBridge, HostRequestError, object } from './bridge';

type Stage = 'open' | 'in-progress' | 'ready' | 'done' | 'archive';
// The default workflow's names (`statusCategoryLabels`); a project's own label from the result wins.
const stageLabels: Record<Stage, string> = { open: 'Open', 'in-progress': 'In progress', ready: 'Ready to verify', done: 'Done', archive: 'Archive' };
// BRAND.md, "Status": Open is an outlined ink ring, not filled. Archive stays neutral.
const stageDots: Record<Stage, string> = { open: 'border border-foreground', 'in-progress': 'bg-[hsl(var(--brand-in-progress))]', ready: 'bg-[hsl(var(--brand-ready))]', done: 'bg-[hsl(var(--brand-success))]', archive: 'bg-muted-foreground' };
type Status = { stage: Stage; label: string };
/** `connecting` until the host answers `ui/initialize`; `failed` and `closed` (teardown) are final. */
type Connection = 'connecting' | 'connected' | 'failed' | 'closed';
type View = {
    context?: FeedbackContext; status?: Status; checkedAt?: number;
    state: 'loading' | 'snapshot' | 'fresh' | 'stale' | 'unavailable';
    connection: Connection; busy: boolean; announcement: string;
};

function payload(result: unknown) {
    const value = object(result);
    if (object(value?.structuredContent)) return object(value!.structuredContent);
    // Text is also supplied for clients that don't preserve structuredContent.
    if (Array.isArray(value?.content)) for (const item of value.content) {
        const part = object(item);
        if (part?.type === 'text' && typeof part.text === 'string') {
            try { return object(JSON.parse(part.text)); } catch { /* Try the next block. */ }
        }
    }
    return undefined;
}

function feedback(value: unknown): FeedbackContext | undefined {
    const context = object(value);
    const identity = object(context?.identity);
    if (context?.schemaVersion !== 1 || typeof context.title !== 'string' || !identity
        || typeof identity.projectId !== 'string' || typeof identity.commentId !== 'string'
        || (context.status !== 'open' && context.status !== 'done')
        || !Array.isArray(context.discussion) || !object(context.links) || !object(context.source)) return;
    return context as FeedbackContext;
}

function threadStatus(context: FeedbackContext, workflow: unknown): Status {
    const status = object(workflow);
    const stage: Stage = typeof status?.category === 'string' && Object.hasOwn(stageLabels, status.category) ? status.category as Stage
        : context.archivedAt ? 'archive' : context.stage && Object.hasOwn(stageLabels, context.stage) ? context.stage : context.status;
    return { stage, label: typeof status?.label === 'string' && status.label ? status.label : stageLabels[stage] };
}

function safeLink(value: unknown) {
    if (typeof value !== 'string') return;
    try {
        const url = new URL(value);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
    } catch { /* Unavailable link. */ }
}

function ThreadCard() {
    const [view, setView] = useState<View>({ state: 'loading', connection: 'connecting', busy: false, announcement: '' });
    const [linkError, setLinkError] = useState(false);
    const refreshRef = useRef<() => void>(() => {});
    const bridgeRef = useRef<AppBridge | null>(null);
    useEffect(() => {
        const bridge = new AppBridge();
        bridgeRef.current = bridge;
        let identity: { projectId: string; commentId: string } | undefined;
        let ready = false, busy = false, stopped = false, unavailable = false, hasSnapshot = false;
        let version = 0;
        const theme = (value: unknown) => {
            const name = object(value)?.theme;
            if (name === 'light' || name === 'dark') document.documentElement.classList.toggle('dark', name === 'dark');
        };
        // A host may wrap authentication failures as generic tool errors, and a JSON-RPC error can't
        // tell denied access from a client that lost its server. Never leave private content visible.
        const clear = () => {
            unavailable = true;
            hasSnapshot = false;
            setView(previous => ({ state: 'unavailable', connection: previous.connection, busy: false, announcement: '' }));
        };
        const apply = (result: unknown, checked: boolean) => {
            if (stopped) return;
            const data = payload(result);
            const context = feedback(data?.context);
            if (object(result)?.isError || !context) return clear();
            if (identity && (context.identity.projectId !== identity.projectId || context.identity.commentId !== identity.commentId)) return;
            identity = { projectId: context.identity.projectId!, commentId: context.identity.commentId };
            hasSnapshot = true;
            unavailable = false;
            const status = threadStatus(context, data?.workflowStatus);
            setView(previous => ({ ...previous, context, status, state: checked ? 'fresh' : 'snapshot', checkedAt: checked ? Date.now() : undefined, busy: false,
                // Announce only a changed status of the thread on screen: not its first result or each refresh.
                announcement: previous.status && previous.status.label !== status.label ? `Status changed to ${status.label}.` : previous.announcement }));
        };
        const refresh = async () => {
            if (!ready || busy || stopped || !identity || document.hidden) return;
            busy = true;
            const currentVersion = version;
            setView(previous => ({ ...previous, busy: true }));
            try {
                const result = await bridge.request('tools/call', { name: 'get_feedback', arguments: identity });
                if (currentVersion === version) apply(result, true);
            } catch (error) {
                if (!stopped && currentVersion === version) {
                    if (error instanceof HostRequestError) clear();
                    // No answer in time: keep the last result on screen, and keep checking.
                    else setView(previous => ({ ...previous, state: previous.context ? 'stale' : previous.state }));
                }
            } finally {
                busy = false;
                if (!stopped) setView(previous => ({ ...previous, busy: false }));
            }
        };
        refreshRef.current = () => { void refresh(); };
        const stop = () => {
            stopped = true;
            ready = false;
            clearInterval(interval);
            observer.disconnect();
            document.removeEventListener('visibilitychange', visibility);
        };
        bridge.onNotification = (method, params) => {
            if (method === 'ui/notifications/host-context-changed') theme(params);
            if (method === 'ui/notifications/tool-input') {
                const args = object(object(params)?.arguments);
                if (typeof args?.projectId === 'string' && typeof args.commentId === 'string') {
                    if (identity && (identity.projectId !== args.projectId || identity.commentId !== args.commentId)) {
                        version++;
                        hasSnapshot = false;
                        setView(previous => ({ state: 'loading', connection: previous.connection, busy: false, announcement: '' }));
                    }
                    identity = { projectId: args.projectId, commentId: args.commentId };
                }
            }
            if (method === 'ui/notifications/tool-result') {
                apply(params, false);
                // Restored conversations may replay an old result. Revalidate before claiming
                // this card is current, and check again while the card remains visible.
                if (!unavailable) void refresh();
            }
            if (method === 'ui/notifications/tool-cancelled') {
                version++;
                clear();
            }
            if (method === 'ui/resource-teardown') {
                stop();
                setView(previous => ({ ...previous, connection: 'closed', busy: false }));
            }
        };
        document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
        void bridge.request('ui/initialize', {
            protocolVersion: '2026-01-26', appInfo: { name: 'uier thread', version: '1.0.0' }, appCapabilities: {},
        }).then(result => {
            if (stopped) return;
            theme(object(result)?.hostContext);
            ready = true;
            setView(previous => ({ ...previous, connection: 'connected' }));
            bridge.notify('ui/notifications/initialized');
        }).catch(() => {
            if (stopped) return;
            // Without the handshake there is no host to read through: nothing more can arrive or refresh.
            stop();
            setView(previous => ({ ...previous, connection: 'failed', busy: false }));
        });
        const visibility = () => { if (!document.hidden && hasSnapshot && !unavailable) void refresh(); };
        document.addEventListener('visibilitychange', visibility);
        const interval = setInterval(() => { if (hasSnapshot && !unavailable) void refresh(); }, 30_000);
        const observer = new ResizeObserver(() => {
            if (ready && !stopped) bridge.notify('ui/notifications/size-changed', { height: Math.ceil(document.body.getBoundingClientRect().height), width: window.innerWidth });
        });
        observer.observe(document.body);
        return () => {
            stop();
            bridge.dispose();
        };
    }, []);

    const { context, status } = view;
    const latest = context?.discussion.slice().reverse().find(item => !item.deleted) ?? (context?.feedback?.deleted ? undefined : context?.feedback);
    const assignees = context?.assignees ?? (context?.assignee ? [context.assignee] : []);
    const link = safeLink(context?.links.comment);
    // Disabled only when a read can't happen. A refresh already in progress ignores more clicks, so the
    // button keeps focus through every 30-second check.
    const canRefresh = view.connection === 'connected' && view.state !== 'loading';
    const warning = view.connection === 'failed' || view.connection === 'closed' || view.state === 'stale' || view.state === 'unavailable';
    const notice = view.connection === 'failed' ? 'Could not connect to your client. Ask for this thread again.'
        : view.connection === 'closed' ? 'Updates stopped. Ask for this thread again to see its current status.'
        : view.state === 'unavailable' ? 'This thread is unavailable. Access may have changed, or your client disconnected.'
        : view.state === 'stale' ? 'Could not check for updates. Showing the last result.'
        : view.state === 'fresh' ? 'Updates every 30 seconds'
        : view.state === 'snapshot' ? 'Checking current status…' : 'Loading thread…';
    return <main className="mx-auto max-w-2xl p-4 text-sm">
        <article className="space-y-4" aria-label="uier thread">
            <header className="flex items-center justify-between gap-3">
                <Logo size={20} />
                {context && <span className="text-muted-foreground">{context.identity.number ? `uier #${context.identity.number}` : 'Thread'}</span>}
            </header>
            {context && status && <>
                <div className="space-y-2">
                    <h1 className="text-lg leading-snug font-semibold break-words">{context.title}</h1>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Badge variant="outline" className="max-w-full gap-1.5">
                            <span aria-hidden="true" data-status-dot={status.stage} className={`size-1.5 shrink-0 rounded-full ${stageDots[status.stage]}`} />
                            <span className="sr-only">Status: </span><span className="truncate">{status.label}</span>
                        </Badge>
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                            <User aria-hidden="true" className="size-4 shrink-0" />
                            <span className="break-words">{assignees.length ? <><span className="sr-only">Assigned to </span>{assignees.map(person => person.name).join(', ')}</> : 'Unassigned'}</span>
                        </span>
                    </div>
                </div>
                <p className="truncate text-xs text-muted-foreground" title={context.source.path}>{context.source.path}{context.source.environment ? ` · ${context.source.environment}` : ''}</p>
                <section className="space-y-2 rounded-xl border border-border p-3" aria-label="Latest message">
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                        <span>{latest?.authorName ?? 'Latest message'}</span>
                        <span>{context.discussion.length} {context.discussion.length === 1 ? 'reply' : 'replies'}</span>
                    </div>
                    <p className="line-clamp-5 whitespace-pre-wrap break-words">{latest?.text || (latest?.screenshot ? 'Image attached. Open the thread to view it.' : 'Message unavailable.')}</p>
                </section>
            </>}
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <div className="space-y-1 text-xs text-muted-foreground">
                    {/* Only messages that change what the card can do are live; the time changes every check. */}
                    <div className="space-y-1" role="status" aria-live="polite">
                        <p className={warning ? 'text-foreground' : undefined}>{notice}</p>
                        {linkError && <p>Could not open the link. Use the thread link in the conversation.</p>}
                    </div>
                    {view.checkedAt && <p>Last checked <time dateTime={new Date(view.checkedAt).toISOString()}>{new Date(view.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></p>}
                </div>
                <p className="sr-only" role="status" aria-live="polite" data-status-announcement="">{view.announcement}</p>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={!canRefresh} aria-busy={view.busy} onClick={() => refreshRef.current()}>
                        {view.busy ? <Spinner className="motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" />}Refresh
                    </Button>
                    {link && <Button size="sm" onClick={() => {
                        setLinkError(false);
                        void bridgeRef.current?.request('ui/open-link', { url: link }).catch(() => setLinkError(true));
                    }}>Open in uier<ArrowUpRight aria-hidden="true" /></Button>}
                </div>
            </footer>
        </article>
    </main>;
}

createRoot(document.getElementById('root')!).render(<ThreadCard />);
