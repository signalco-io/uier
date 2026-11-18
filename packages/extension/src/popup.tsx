import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { List } from '@signalco/ui-primitives/List';
import { ListItem } from '@signalco/ui-primitives/ListItem';
import { Check, Disabled, ExternalLink, Globe, LoaderSpinner, LogOut, Warning } from '@signalco/ui-icons';
import { brand } from '@uier/brand';
import { Logo } from '@uier/brand/Logo';
import { apiOrigin, message } from './environment';
import { followSystemTheme } from './theme';
import type { UpdateState } from './update';

type Project = { id: string; projectId: string; name: string; access: string; workspaceName?: string };
/** The popup's frame (`tab`): what the worker knows of the sign-in and the active tab without asking uier */
type Tab = {
    signedIn: boolean; restricted?: boolean; tabId?: number; origin?: string;
    /** An active review in this tab, and the project it uses */
    binding?: boolean; reviewing?: string;
};
/** The full answer (`state`): the frame as uier confirms it, with the site's projects and the account */
type State = Tab & { canSetUp?: boolean; projects?: Project[]; account?: { name: string; email: string } };
type Action = 'refresh' | 'sign-in' | 'sign-out' | 'start' | 'exit' | 'install-update';
/**
 * What the popup most often becomes: signed in, on a site with projects. Until the worker's first answer this frame
 * is laid out but hidden under "Connecting to uier.", so the popup opens at its usual height and resizes at most
 * once. The address only has to take its line.
 */
const expected: Tab = { signedIn: true, origin: apiOrigin };

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

/**
 * A line of an outline where text is loading, in that text's own line box (`h-5` a project's name, `h-4` small text),
 * so nothing moves when the text arrives. Decorative: the popup's status says what is loading. `pulse` is for a
 * line that stands alone; inside a pulsing outline it stays still.
 */
function OutlineLine({ line, width, pulse }: { line: 'h-4' | 'h-5'; width: string; pulse?: boolean }) {
    return <span aria-hidden="true" data-slot={pulse ? 'skeleton' : undefined} className={cx('flex items-center', line, pulse && 'motion-safe:animate-pulse')}>
        <span className={cx('rounded-sm bg-accent', line === 'h-5' ? 'h-3' : 'h-2.5', width)} />
    </span>;
}

/**
 * Where the projects go while uier answers: the list's own frame with two rows of a project's height, its name over
 * its workspace. Two is the tallest common list; a site with one project gives a row back.
 */
function ProjectsOutline() {
    return <List variant="outlined" aria-hidden="true" data-slot="skeleton" className="motion-safe:animate-pulse">
        {['w-24', 'w-32'].map(width => <div key={width} className="flex flex-col p-3">
            <OutlineLine line="h-5" width={width} />
            <OutlineLine line="h-4" width="w-20" />
        </div>)}
    </List>;
}

function Popup() {
    const [tab, setTab] = useState<Tab>();
    const [state, setState] = useState<State>();
    const [selected, setSelected] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState<Action>();
    const [update, setUpdate] = useState<UpdateState>();
    const opening = useRef<Promise<void>>(undefined);
    const refresh = async () => {
        const value = await message<State>({ type: 'state' });
        setState(value);
        setSelected(previous => value.projects?.some(project => project.projectId === previous) ? previous
            : value.projects?.find(project => project.projectId === value.reviewing)?.projectId
            ?? (value.projects?.length === 1 ? value.projects[0]!.projectId : ''));
    };
    useEffect(() => {
        // The frame first: the worker answers `tab` from its own state. `state` asks uier and stays the authority, so
        // only it can fail the popup; without the frame's answer the popup waits for it under "Connecting to uier.".
        void message<Tab>({ type: 'tab' }).then(setTab, () => {});
        opening.current = refresh().catch(error => setError(error.message));
    }, []);
    // Separate from the review state: a failed update check never blocks the popup.
    useEffect(() => { void message<UpdateState>({ type: 'update' }).then(setUpdate, () => {}); }, []);
    const run = async (action: Action, operation: () => Promise<unknown>) => {
        setBusy(action);
        // The frame's controls work before uier's first answer. An action waits for it, so answers never overlap.
        await opening.current;
        setError('');
        try { await operation(); await refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'The extension could not connect.'); }
        finally { setBusy(undefined); }
    };
    // uier's first answer failed: there is nothing to show beside the error
    const failed = !state && Boolean(error);
    const answered = state ?? tab;
    const connecting = !answered && !failed;
    const view: State = answered ?? expected;
    // Signed in on a site: the frame is known, its projects and the account are uier's to answer
    const loading = !state && !failed && view.signedIn && !view.restricted;
    // The account's controls and the footer; as before, the failed view has none
    const signedIn = view.signedIn && !failed;
    const project = state?.projects?.find(p => p.projectId === selected);
    const reviewing = view.binding ? state?.projects?.find(p => p.projectId === view.reviewing) : undefined;
    const siteHeading = <div className="flex flex-col gap-1">
        <Heading>Review this site</Heading>
        {view.origin && <Site origin={view.origin} />}
    </div>;
    const reviewStatus = view.binding && <>
        <div role="status" className="flex flex-col gap-1 rounded-lg border px-3 py-2.5">
            <p className="m-0 flex items-center gap-2 text-sm font-medium">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-success))]" />
                <span className="min-w-0 break-words">{reviewing ? <>Reviewing {reviewing.name}</> : 'Review is on'}</span>
            </p>
            {/* The project's workspace: its line is held while uier answers */}
            {loading
                ? <OutlineLine line="h-4" width="w-24" pulse />
                : reviewing?.workspaceName && <p className="m-0 break-words text-xs text-muted-foreground">{reviewing.workspaceName}</p>}
            <p className="m-0 text-xs text-muted-foreground">The toolbar stays on this tab when you reload or open other pages of this site.</p>
        </div>
        <Button variant="outlined" fullWidth loading={busy === 'exit'} disabled={Boolean(busy)} onClick={() => run('exit', () => message({ type: 'exit', tabId: view.tabId }))}>Exit review</Button>
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
    if (failed) {
        body = <>
            <IconTile><Warning size={20} strokeWidth={1.75} /></IconTile>
            <div className="flex flex-col gap-1">
                <Heading>uier is not reachable</Heading>
                <p role="alert" className="m-0 text-sm text-muted-foreground">{error} Check your connection and try again.</p>
            </div>
            <Button variant="outlined" fullWidth loading={busy === 'refresh'} onClick={() => run('refresh', refresh)}>Try again</Button>
        </>;
    } else if (!view.signedIn) {
        body = <>
            <div className="flex flex-col gap-1">
                <Heading>Sign in to review sites</Heading>
                <p className="m-0 text-sm text-muted-foreground">{brand.shortDescription}</p>
            </div>
            {errorNotice}
            <Button variant="solid" fullWidth loading={busy === 'sign-in'} onClick={() => run('sign-in', () => message({ type: 'sign-in' }))}>Sign in to uier</Button>
            <p className="m-0 text-xs text-muted-foreground">For members of uier projects, including invited reviewers.</p>
        </>;
    } else if (view.restricted) {
        body = <>
            <IconTile><Disabled size={20} strokeWidth={1.75} /></IconTile>
            <div className="flex flex-col gap-1">
                <Heading>This page cannot be reviewed</Heading>
                <p className="m-0 text-sm text-muted-foreground">Open a website to start a review. Browser pages, extension stores and local files are not supported.</p>
            </div>
            {errorNotice}
        </>;
    } else if (loading) {
        // The frame is real; outlines stand only where uier's answer goes, each in the box of what replaces it.
        body = <>
            {siteHeading}
            {reviewStatus}
            <div className="flex flex-col gap-2">
                <p className="m-0 text-xs font-medium text-muted-foreground">Project</p>
                <ProjectsOutline />
            </div>
            <div className="flex flex-col gap-2">
                <Button variant="solid" fullWidth disabled>{view.binding ? 'Switch review' : 'Start review'}</Button>
                <OutlineLine line="h-4" width="w-3/5" pulse />
            </div>
        </>;
    } else if (!view.projects?.length) {
        body = <>
            {siteHeading}
            {reviewStatus}
            <div className="flex flex-col items-start gap-3 rounded-lg bg-muted p-4">
                <div className="flex flex-col gap-1">
                    <p className="m-0 text-sm font-medium">No project includes this address</p>
                    <p className="m-0 text-sm text-muted-foreground">{view.canSetUp
                        ? 'Add this exact address to a project, then open this again.'
                        : 'Ask a project admin to add this exact address or to invite you.'}</p>
                </div>
                {view.canSetUp && <Button variant="outlined" size="sm" className="bg-background" href={`${apiOrigin}/app/projects`} target="_blank" rel="noopener noreferrer"
                    endDecorator={<ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />}>Open project setup</Button>}
            </div>
            {errorNotice}
        </>;
    } else {
        const many = view.projects.length > 1;
        body = <>
            {siteHeading}
            {reviewStatus}
            <div className="flex flex-col gap-2">
                <p id="projects-label" className="m-0 text-xs font-medium text-muted-foreground">{many ? 'Choose a project' : 'Project'}</p>
                <List variant="outlined" className="max-h-60 overflow-y-auto" role="group" aria-labelledby="projects-label">
                    {view.projects.map(item => {
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
                <Button variant="solid" fullWidth loading={busy === 'start'} disabled={Boolean(busy) || !project || project.access === 'disabled' || (view.binding && selected === view.reviewing)}
                    onClick={() => run('start', () => message({ type: 'start', tabId: view.tabId!, projectId: project!.projectId, publicId: project!.id }))}>{view.binding ? 'Switch review' : 'Start review'}</Button>
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
        {/* One cell for the frame and the opening line: while hidden, the frame gives "Connecting to uier." its height */}
        <div className="grid grid-cols-1">
            <div className={cx('col-start-1 row-start-1 min-w-0', connecting && 'invisible')}>
                <div className="flex flex-col gap-4 p-4">{updateNotice}{body}
                    {signedIn && <div className="flex min-w-0 flex-col gap-2">
                        {/* The account's email is uier's to answer; its line is held meanwhile */}
                        {loading
                            ? <OutlineLine line="h-4" width="w-40" pulse />
                            : view.account && <p className="m-0 break-all text-xs text-muted-foreground">{view.account.email}</p>}
                        <Button variant="outlined" fullWidth loading={busy === 'sign-in'} disabled={Boolean(busy)}
                            onClick={() => run('sign-in', () => message({ type: 'sign-in' }))}>Switch account</Button>
                        <p className="m-0 text-xs text-muted-foreground">Choose a signed-in account in uier. Switching ends active reviews in all tabs.</p>
                    </div>}
                </div>
                {signedIn && <footer className="flex items-center justify-between gap-2 border-t px-2 py-2">
                    <Button variant="plain" size="sm" className="text-muted-foreground hover:text-foreground" href={`${apiOrigin}/app`} target="_blank" rel="noopener noreferrer"
                        startDecorator={<ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />}>Open uier</Button>
                    <Button variant="plain" size="sm" className="text-muted-foreground hover:text-foreground" loading={busy === 'sign-out'} disabled={Boolean(busy)}
                        startDecorator={<LogOut size={16} strokeWidth={1.75} aria-hidden="true" />}
                        onClick={() => run('sign-out', () => message({ type: 'sign-out' }))}>Sign out</Button>
                </footer>}
            </div>
            {/* One status for both steps of opening, mounted throughout so a screen reader hears each change */}
            <p role="status" className={connecting ? 'col-start-1 row-start-1 m-0 flex items-center gap-2 self-start px-4 py-6 text-sm text-muted-foreground' : 'sr-only'}>
                {connecting && <LoaderSpinner size={16} aria-hidden="true" className="animate-spin" />}
                {connecting ? 'Connecting to uier.' : loading ? 'Loading projects.' : ''}
            </p>
        </div>
    </main>;
}

followSystemTheme();
createRoot(document.getElementById('root')!).render(<Popup />);
