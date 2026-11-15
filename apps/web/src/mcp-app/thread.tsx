import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Logo } from '@uier/brand/Logo';
import type { FeedbackContext } from '@uier/toolbar/feedback-context';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '../components/ui/button';
import { AppBridge, HostRequestError, object } from './bridge';

const stageLabels = { open: 'Open', 'in-progress': 'In progress', ready: 'Ready to verify', done: 'Done', archive: 'Archived' };
const stageColors = { open: 'bg-muted-foreground', 'in-progress': 'bg-[hsl(var(--brand-in-progress))]', ready: 'bg-[hsl(var(--brand-ready))]', done: 'bg-[hsl(var(--brand-success))]', archive: 'bg-muted-foreground' };
type Snapshot = { context?: FeedbackContext; statusLabel?: string; category?: keyof typeof stageLabels; checkedAt?: number; state: 'loading' | 'snapshot' | 'fresh' | 'stale' | 'unavailable'; busy: boolean };

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

function safeLink(value: unknown) {
    if (typeof value !== 'string') return;
    try {
        const url = new URL(value);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
    } catch { /* Unavailable link. */ }
}

function ThreadCard() {
    const [snapshot, setSnapshot] = useState<Snapshot>({ state: 'loading', busy: false });
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
        const apply = (result: unknown, checked: boolean) => {
            if (stopped) return;
            const data = payload(result);
            const context = feedback(data?.context);
            if (object(result)?.isError || !context) {
                // A host may wrap authentication failures as generic tool errors. Never leave
                // private content visible following a refused/invalid read.
                unavailable = true;
                hasSnapshot = false;
                setSnapshot({ state: 'unavailable', busy: false });
                return;
            }
            if (identity && (context.identity.projectId !== identity.projectId || context.identity.commentId !== identity.commentId)) return;
            identity = { projectId: context.identity.projectId!, commentId: context.identity.commentId };
            hasSnapshot = true;
            unavailable = false;
            const workflow = object(data?.workflowStatus);
            setSnapshot({ context, statusLabel: typeof workflow?.label === 'string' ? workflow.label : undefined,
                category: typeof workflow?.category === 'string' && Object.hasOwn(stageLabels, workflow.category) ? workflow.category as keyof typeof stageLabels : undefined,
                state: checked ? 'fresh' : 'snapshot', checkedAt: checked ? Date.now() : undefined, busy: false });
        };
        const refresh = async () => {
            if (!ready || busy || stopped || !identity || document.hidden) return;
            busy = true;
            const currentVersion = version;
            setSnapshot(previous => ({ ...previous, busy: true }));
            try {
                const result = await bridge.request('tools/call', { name: 'get_feedback', arguments: identity });
                if (currentVersion === version) apply(result, true);
            } catch (error) {
                if (!stopped && currentVersion === version) {
                    if (error instanceof HostRequestError) {
                        unavailable = true;
                        hasSnapshot = false;
                        setSnapshot({ state: 'unavailable', busy: false });
                    } else setSnapshot(previous => ({ ...previous, state: 'stale', busy: false }));
                }
            } finally {
                busy = false;
                if (!stopped) setSnapshot(previous => ({ ...previous, busy: false }));
            }
        };
        refreshRef.current = () => { void refresh(); };
        bridge.onNotification = (method, params) => {
            if (method === 'ui/notifications/host-context-changed') theme(params);
            if (method === 'ui/notifications/tool-input') {
                const args = object(object(params)?.arguments);
                if (typeof args?.projectId === 'string' && typeof args.commentId === 'string') {
                    if (identity && (identity.projectId !== args.projectId || identity.commentId !== args.commentId)) {
                        version++;
                        hasSnapshot = false;
                        setSnapshot({ state: 'loading', busy: false });
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
                hasSnapshot = false;
                unavailable = true;
                setSnapshot({ state: 'unavailable', busy: false });
            }
            if (method === 'ui/resource-teardown') {
                stopped = true;
                clearInterval(interval);
                observer.disconnect();
                document.removeEventListener('visibilitychange', visibility);
                setSnapshot(previous => ({ ...previous, state: previous.context ? 'stale' : 'unavailable', busy: false }));
            }
        };
        document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
        void bridge.request('ui/initialize', {
            protocolVersion: '2026-01-26', appInfo: { name: 'uier thread', version: '1.0.0' }, appCapabilities: {},
        }).then(result => {
            if (stopped) return;
            theme(object(result)?.hostContext);
            ready = true;
            bridge.notify('ui/notifications/initialized');
        }).catch(() => { if (!stopped) setSnapshot({ state: 'stale', busy: false }); });
        const visibility = () => {
            if (document.hidden) setSnapshot(previous => ({ ...previous, state: previous.context ? 'stale' : previous.state }));
            else if (hasSnapshot && !unavailable) void refresh();
        };
        document.addEventListener('visibilitychange', visibility);
        const interval = setInterval(() => { if (hasSnapshot && !unavailable) void refresh(); }, 30_000);
        const observer = new ResizeObserver(() => {
            if (ready && !stopped) bridge.notify('ui/notifications/size-changed', { height: Math.ceil(document.body.getBoundingClientRect().height), width: window.innerWidth });
        });
        observer.observe(document.body);
        return () => {
            stopped = true;
            clearInterval(interval);
            document.removeEventListener('visibilitychange', visibility);
            observer.disconnect();
            bridge.dispose();
        };
    }, []);

    const context = snapshot.context;
    const stage = snapshot.category ?? (context?.archivedAt ? 'archive' : context?.stage && Object.hasOwn(stageLabels, context.stage) ? context.stage : context?.status ?? 'open');
    const latest = context?.discussion.slice().reverse().find(item => !item.deleted) ?? (context?.feedback?.deleted ? undefined : context?.feedback);
    const assignees = context?.assignees ?? (context?.assignee ? [context.assignee] : []);
    const link = safeLink(context?.links.comment);
    const freshness = snapshot.state === 'fresh' ? 'Updates every 30 seconds'
        : snapshot.state === 'snapshot' ? 'Checking current status…'
        : snapshot.state === 'unavailable' ? 'This thread is unavailable. Access may have changed.'
        : snapshot.state === 'stale' ? 'Updates paused. Reconnect your client, then refresh.' : 'Loading thread…';
    return <main className="mx-auto max-w-2xl p-4 text-sm">
        <article className="space-y-4" aria-label="uier thread">
            <header className="flex items-center justify-between gap-3">
                <Logo size={20} />
                {context && <span className="text-muted-foreground">{context.identity.number ? `uier #${context.identity.number}` : 'Thread'}</span>}
            </header>
            {context && <>
                <div className="space-y-2">
                    <h1 className="text-lg leading-snug font-semibold break-words">{context.title}</h1>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs font-medium">
                            <span aria-hidden="true" className={`size-1.5 rounded-full ${stageColors[stage]}`} />{snapshot.statusLabel ?? stageLabels[stage]}
                        </span>
                        <span className="text-muted-foreground break-words">{assignees.length ? assignees.map(person => person.name).join(', ') : 'Unassigned'}</span>
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
                <div className="space-y-1 text-xs text-muted-foreground" role="status" aria-live="polite">
                    <p>{freshness}</p>
                    {snapshot.checkedAt && <p>Last checked <time dateTime={new Date(snapshot.checkedAt).toISOString()}>{new Date(snapshot.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></p>}
                    {linkError && <p>Could not open the link. Use the thread link in the conversation.</p>}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={snapshot.busy || snapshot.state === 'loading'} onClick={() => refreshRef.current()}>
                        <RefreshCw aria-hidden="true" />{snapshot.busy ? 'Refreshing…' : 'Refresh'}
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
