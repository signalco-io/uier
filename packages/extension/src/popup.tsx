import { createRoot } from 'react-dom/client';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { List } from '@signalco/ui-primitives/List';
import { ListItem } from '@signalco/ui-primitives/ListItem';
import { Check, Disabled, ExternalLink, Globe, LoaderSpinner, LogOut, Warning } from '@signalco/ui-icons';
import { brand } from '@uier/brand';
import { Logo } from '@uier/brand/Logo';
import { apiOrigin, message } from './environment';
import { followSystemTheme } from './theme';
import type { UpdateState } from './update';

type Project = { id: string; projectId: string; name: string; access: string; workspaceName?: string };
type State = {
    signedIn: boolean; restricted?: boolean; tabId?: number; origin?: string;
    /** An active review in this tab, and the project it uses */
    binding?: boolean; reviewing?: string;
    canSetUp?: boolean; projects?: Project[]; account?: { name: string; email: string };
};
type Action = 'refresh' | 'sign-in' | 'sign-out' | 'start' | 'exit' | 'install-update';

/** The reviewed site's address, in mono because a machine wrote it (BRAND.md, "Typography") */
function Site({ origin }: { origin: string }) {
    const { host, protocol } = new URL(origin);
    return <p className="m-0 flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Globe size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <span className="sr-only">Site: </span>
        <span className="truncate font-mono text-[13px] leading-5" title={origin}>{protocol === 'http:' ? origin : host}</span>
    </p>;
}

function Heading({ children }: { children: ReactNode }) {
    return <h1 className="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">{children}</h1>;
}

/** An icon on a bordered tile, above a heading (restricted page, failed connection) */
function IconTile({ children }: { children: ReactNode }) {
    return <div aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl border text-muted-foreground">{children}</div>;
}

function Popup() {
    const [state, setState] = useState<State>();
    const [selected, setSelected] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState<Action>();
    const [update, setUpdate] = useState<UpdateState>();
    const refresh = async () => {
        const value = await message<State>({ type: 'state' });
        setState(value);
        setSelected(previous => value.projects?.some(project => project.projectId === previous) ? previous
            : value.projects?.find(project => project.projectId === value.reviewing)?.projectId
            ?? (value.projects?.length === 1 ? value.projects[0]!.projectId : ''));
    };
    useEffect(() => { void refresh().catch(error => setError(error.message)); }, []);
    // Separate from the review state: a failed update check never blocks the popup.
    useEffect(() => { void message<UpdateState>({ type: 'update' }).then(setUpdate, () => {}); }, []);
    const run = async (action: Action, operation: () => Promise<unknown>) => {
        setBusy(action); setError('');
        try { await operation(); await refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'The extension could not connect.'); }
        finally { setBusy(undefined); }
    };
    const project = state?.projects?.find(p => p.projectId === selected);
    const reviewing = state?.binding ? state.projects?.find(p => p.projectId === state.reviewing) : undefined;
    const reviewStatus = state?.binding && <>
        <div role="status" className="flex flex-col gap-1 rounded-lg border px-3 py-2.5">
            <p className="m-0 flex items-center gap-2 text-sm font-medium">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-success))]" />
                <span className="min-w-0 break-words">{reviewing ? <>Reviewing {reviewing.name}</> : 'Review is on'}</span>
            </p>
            {reviewing?.workspaceName && <p className="m-0 break-words text-xs text-muted-foreground">{reviewing.workspaceName}</p>}
            <p className="m-0 text-xs text-muted-foreground">The toolbar stays on this tab when you reload or open other pages of this site.</p>
        </div>
        <Button variant="outlined" fullWidth loading={busy === 'exit'} disabled={Boolean(busy)} onClick={() => run('exit', () => message({ type: 'exit', tabId: state.tabId }))}>Exit review</Button>
    </>;

    const errorNotice = error && <div role="alert" className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm">
        <Warning size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-[hsl(var(--brand-warning))]" />
        <p className="m-0 min-w-0 flex-1">{error}</p>
    </div>;

    // Only after the browser has the update: a newer version on uier can still be in store review.
    const updateNotice = update?.ready && <section aria-labelledby="update-heading" className="flex flex-col items-start gap-3 rounded-lg border px-3 py-2.5">
        <div className="flex flex-col gap-1">
            <p id="update-heading" className="m-0 text-sm font-medium">Update ready</p>
            <p className="m-0 text-xs text-muted-foreground">Version {update.ready} is downloaded. Restarting ends active reviews in open tabs.</p>
        </div>
        <Button variant="outlined" size="sm" loading={busy === 'install-update'} disabled={Boolean(busy)}
            onClick={() => run('install-update', () => message({ type: 'install-update' }))}>Restart and update</Button>
    </section>;

    let body: ReactNode;
    if (!state && error) {
        body = <>
            <IconTile><Warning size={20} strokeWidth={1.75} /></IconTile>
            <div className="flex flex-col gap-1">
                <Heading>uier is not reachable</Heading>
                <p role="alert" className="m-0 text-sm text-muted-foreground">{error} Check your connection and try again.</p>
            </div>
            <Button variant="outlined" fullWidth loading={busy === 'refresh'} onClick={() => run('refresh', refresh)}>Try again</Button>
        </>;
    } else if (!state) {
        body = <p role="status" className="m-0 flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <LoaderSpinner size={16} aria-hidden="true" className="animate-spin" />
            Connecting to uier.
        </p>;
    } else if (!state.signedIn) {
        body = <>
            <div className="flex flex-col gap-1">
                <Heading>Sign in to review sites</Heading>
                <p className="m-0 text-sm text-muted-foreground">{brand.shortDescription}</p>
            </div>
            {errorNotice}
            <Button variant="solid" fullWidth loading={busy === 'sign-in'} onClick={() => run('sign-in', () => message({ type: 'sign-in' }))}>Sign in to uier</Button>
            <p className="m-0 text-xs text-muted-foreground">For members of uier projects, including invited reviewers.</p>
        </>;
    } else if (state.restricted) {
        body = <>
            <IconTile><Disabled size={20} strokeWidth={1.75} /></IconTile>
            <div className="flex flex-col gap-1">
                <Heading>This page cannot be reviewed</Heading>
                <p className="m-0 text-sm text-muted-foreground">Open a website to start a review. Browser pages, extension stores and local files are not supported.</p>
            </div>
            {errorNotice}
        </>;
    } else if (!state.projects?.length) {
        body = <>
            <div className="flex flex-col gap-1">
                <Heading>Review this site</Heading>
                {state.origin && <Site origin={state.origin} />}
            </div>
            {reviewStatus}
            <div className="flex flex-col items-start gap-3 rounded-lg bg-muted p-4">
                <div className="flex flex-col gap-1">
                    <p className="m-0 text-sm font-medium">No project includes this address</p>
                    <p className="m-0 text-sm text-muted-foreground">{state.canSetUp
                        ? 'Add this exact address to a project, then open this again.'
                        : 'Ask a project admin to add this exact address or to invite you.'}</p>
                </div>
                {state.canSetUp && <Button variant="outlined" size="sm" className="bg-background" href={`${apiOrigin}/app/projects`} target="_blank" rel="noopener noreferrer"
                    endDecorator={<ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />}>Open project setup</Button>}
            </div>
            {errorNotice}
        </>;
    } else {
        const many = state.projects.length > 1;
        body = <>
            <div className="flex flex-col gap-1">
                <Heading>Review this site</Heading>
                {state.origin && <Site origin={state.origin} />}
            </div>
            {reviewStatus}
            <div className="flex flex-col gap-2">
                <p id="projects-label" className="m-0 text-xs font-medium text-muted-foreground">{many ? 'Choose a project' : 'Project'}</p>
                <List variant="outlined" className="max-h-60 overflow-y-auto" role="group" aria-labelledby="projects-label">
                    {state.projects.map(item => {
                        const isSelected = selected === item.projectId;
                        return <ListItem key={item.projectId} variant="outlined" nodeId={item.projectId} selected={isSelected} onSelected={setSelected}
                            disabled={Boolean(busy)} className="min-h-11 pr-3 pl-3"
                            {...({ 'aria-pressed': isSelected } as object)}
                            label={<span className="flex min-w-0 flex-col py-1 text-left">
                                <span className="break-words">{item.name}</span>
                                {item.workspaceName && <span className={isSelected ? "break-words text-xs font-normal text-foreground" : "break-words text-xs font-normal text-muted-foreground"}>{item.workspaceName}</span>}
                                {item.access === 'disabled' && <span className={isSelected ? "text-xs font-normal text-foreground" : "text-xs font-normal text-muted-foreground"}>Comments off</span>}
                            </span>}
                            endDecorator={<Check size={16} strokeWidth={1.75} aria-hidden="true" className={isSelected ? 'shrink-0' : 'shrink-0 opacity-0'} />} />;
                    })}
                </List>
            </div>
            {errorNotice}
            <div className="flex flex-col gap-2">
                <Button variant="solid" fullWidth loading={busy === 'start'} disabled={Boolean(busy) || !project || project.access === 'disabled' || (state.binding && selected === state.reviewing)}
                    onClick={() => run('start', () => message({ type: 'start', tabId: state.tabId!, projectId: project!.projectId, publicId: project!.id }))}>{state.binding ? 'Switch review' : 'Start review'}</Button>
                <p className="m-0 text-xs text-muted-foreground">{project?.access === 'disabled'
                    ? 'Comments are turned off for this project.'
                    : many && !project
                        ? 'Choose the project to review this site with.'
                        : 'Comment links for this site open after you start the review.'}</p>
            </div>
        </>;
    }

    return <main className="flex w-[340px] flex-col bg-background text-foreground">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <Logo size={20} />
            <span className="text-xs text-muted-foreground">Browser extension</span>
        </header>
        <div className="flex flex-col gap-4 p-4">{updateNotice}{body}
            {state?.signedIn && <div className="flex min-w-0 flex-col gap-2">
                {state.account && <p className="m-0 break-all text-xs text-muted-foreground">{state.account.email}</p>}
                <Button variant="outlined" fullWidth loading={busy === 'sign-in'} disabled={Boolean(busy)}
                    onClick={() => run('sign-in', () => message({ type: 'sign-in' }))}>Switch account</Button>
                <p className="m-0 text-xs text-muted-foreground">Choose a signed-in account in uier. Switching ends active reviews in all tabs.</p>
            </div>}
        </div>
        {state?.signedIn && <footer className="flex items-center justify-between gap-2 border-t px-2 py-2">
            <Button variant="plain" size="sm" className="text-muted-foreground hover:text-foreground" href={`${apiOrigin}/app`} target="_blank" rel="noopener noreferrer"
                startDecorator={<ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />}>Open uier</Button>
            <Button variant="plain" size="sm" className="text-muted-foreground hover:text-foreground" loading={busy === 'sign-out'} disabled={Boolean(busy)}
                startDecorator={<LogOut size={16} strokeWidth={1.75} aria-hidden="true" />}
                onClick={() => run('sign-out', () => message({ type: 'sign-out' }))}>Sign out</Button>
        </footer>}
    </main>;
}

followSystemTheme();
createRoot(document.getElementById('root')!).render(<Popup />);
