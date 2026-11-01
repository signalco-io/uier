import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Logo } from '@uier/brand/Logo';
import { apiOrigin, message } from './environment';

type State = { signedIn: boolean; restricted?: boolean; tabId?: number; binding?: boolean; canSetUp?: boolean; projects?: { id: string; projectId: string; name: string; access: string }[] };
function Popup() {
    const [state, setState] = useState<State>();
    const [selected, setSelected] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const refresh = async () => {
        const value = await message<State>({ type: 'state' });
        setState(value); setSelected(value.projects?.length === 1 ? value.projects[0]!.projectId : '');
    };
    useEffect(() => {
        const scheme = matchMedia('(prefers-color-scheme: dark)');
        const apply = () => document.documentElement.classList.toggle('dark', scheme.matches);
        apply(); scheme.addEventListener('change', apply);
        void refresh().catch(error => setError(error.message));
        return () => scheme.removeEventListener('change', apply);
    }, []);
    const run = async (operation: () => Promise<unknown>) => {
        setBusy(true); setError('');
        try { await operation(); await refresh(); } catch (error) { setError(error instanceof Error ? error.message : 'The extension could not connect.'); }
        finally { setBusy(false); }
    };
    const project = state?.projects?.find(p => p.projectId === selected);
    return <main className="flex flex-col gap-4 bg-background p-4 text-foreground" style={{ width: 340 }}>
        <Logo />
        <h1 className="sr-only">Review this site</h1>
        <p className="m-0 text-sm text-muted-foreground">Browser extension · development preview</p>
        {error && <p role="alert">{error} <Button variant="outlined" onClick={() => run(refresh)}>Try again</Button></p>}
        {!state && !error && <p role="status">Connecting to uier.</p>}
        {state && !state.signedIn && <Button disabled={busy} onClick={() => run(() => message({ type: 'sign-in' }))}>Sign in to uier</Button>}
        {state?.restricted && <p>Open a website to start a review. Browser pages, extension stores and local files cannot be reviewed.</p>}
        {state?.signedIn && !state.restricted && <>
            {!state.projects?.length ? <>
                <p>No project you can access includes this exact site address.</p>
                {state.canSetUp && <Button href={`${apiOrigin}/app/projects`} target="_blank" variant="outlined">Open project setup</Button>}
            </> : <>
                {state.projects.length > 1 && <p>Choose a project for this site.</p>}
                {state.projects.map(project => <Button key={project.projectId} variant="outlined" aria-pressed={selected === project.projectId} onClick={() => setSelected(project.projectId)}>{project.name}</Button>)}
                {project?.access === 'disabled' && <p>Comments are turned off for this project.</p>}
                <Button disabled={busy || !project || project.access === 'disabled'} onClick={() => run(() => message({ type: 'start', tabId: state.tabId, projectId: project!.projectId, publicId: project!.id }))}>Start review</Button>
                {state.binding && <Button variant="outlined" disabled={busy} onClick={() => run(() => message({ type: 'exit', tabId: state.tabId }))}>Exit review</Button>}
            </>}
            <p className="text-sm text-muted-foreground">Each reviewer needs the extension on sites without the script. Existing comment links open after Start review.</p>
        </>}
        {state?.signedIn && <Button variant="outlined" disabled={busy} onClick={() => run(() => message({ type: 'sign-out' }))}>Sign out</Button>}
    </main>;
}
createRoot(document.getElementById('root')!).render(<Popup />);
