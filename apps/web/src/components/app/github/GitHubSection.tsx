'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { getGitHubSettings } from '@/src/lib/integrations/github';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { loadGitHubRepositoriesAction, manageGitHubAction, saveGitHubRepositoryAction } from './actions';

type Settings = Awaited<ReturnType<typeof getGitHubSettings>>;

const outcomes: Record<string, string> = {
    denied: 'The GitHub connection was canceled. You can connect again.',
    failed: 'GitHub could not complete the connection. Connect again.',
    unavailable: 'GitHub is unavailable right now. Try again later.',
    pending: 'An organization owner needs to approve the uier installation in GitHub. Once it is approved, connect GitHub again and choose a repository.'
};

export function GitHubSection({ projectId, settings, outcome }: { projectId: string; settings: Settings; outcome?: string }) {
    const connection = settings.connection;
    const publicConfirmationRequired = connection?.statusCode === 'public_confirmation_required';
    const notice = outcome && Object.hasOwn(outcomes, outcome) ? outcomes[outcome] : undefined;
    const status = !settings.configured ? 'Unavailable' : settings.setup ? 'Choose a repository' : !connection ? (outcome === 'pending' ? 'Approval needed' : 'Not connected')
        : connection.status === 'needs_reconnect' ? 'Reconnect needed' : connection.status === 'paused' ? 'Waiting for GitHub'
        : connection.enabled ? 'Sync on' : 'Sync off';
    return <Section id="github" title="GitHub" description="Create one GitHub issue for each shared feedback thread. uier keeps the issue and its discussion up to date."
        actions={<Badge variant="secondary">{status}</Badge>}>
        <div className="flex flex-col gap-5">
            {notice && (outcome === 'pending' ? <Alert role="status">
                <AlertTitle>Waiting for GitHub approval</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
            </Alert> : <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>)}
            {!settings.configured ? <p className="m-0 text-sm text-muted-foreground">GitHub is unavailable on this deployment. A site administrator needs to configure it.</p>
                : <>
                    {settings.setup ? <GitHubRepositoryPicker key={settings.setup.receipt} projectId={projectId} settings={settings} />
                        : <Button asChild className="w-fit" variant={connection ? 'outline' : 'default'}>
                            <a href={`/app/github/connect?project=${encodeURIComponent(projectId)}`}>
                                <ArrowUpRight data-icon="inline-start" />{connection ? 'Reconnect GitHub' : 'Connect GitHub'}
                            </a>
                        </Button>}
                    {!settings.setup && settings.installations.length > 0 && <div className="flex flex-col gap-2">
                        <p className="m-0 text-sm text-muted-foreground">Or use an installation already connected to this workspace. GitHub verifies your account before you choose a repository.</p>
                        {settings.installations.map(installation => <Button key={installation.id} asChild className="w-fit" variant="outline">
                            <a href={`/app/github/connect?project=${encodeURIComponent(projectId)}&installation=${encodeURIComponent(installation.id)}`}>
                                Use {installation.accountName} installation
                            </a>
                        </Button>)}
                    </div>}
                    {connection && <>
                        <p className="m-0 text-sm">Repository: {connection.repositoryName} ({publicConfirmationRequired ? 'public access needs confirmation' : connection.repositoryVisibility}).</p>
                        {publicConfirmationRequired && <Alert>
                            <AlertTitle>Confirm public repository access</AlertTitle>
                            <AlertDescription>This repository changed from private to public. Sync is paused. Existing copies may be public. Reconnect GitHub and confirm the public repository before copying more feedback.</AlertDescription>
                        </Alert>}
                        {connection.repositoryVisibility === 'public' && <Alert>
                            <AlertTitle>Public repository</AlertTitle>
                            <AlertDescription>Anyone can read the feedback copied to this repository. Private uier threads are excluded.</AlertDescription>
                        </Alert>}
                        {connection.status !== 'connected' && !publicConfirmationRequired && <p className="m-0 text-sm text-muted-foreground">GitHub access needs attention. Check the app’s installation and repository access in GitHub, then reconnect.</p>}
                    </>}
                    <p className="m-0 text-sm text-muted-foreground">The GitHub App’s installation controls repository access. Turning sync on copies new shared feedback; existing threads need a separate backfill. Private threads and the public showcase are excluded.</p>
                    <p className="m-0 text-sm text-muted-foreground">Screenshots stay as protected uier links. GitHub copies, edit histories, notifications and independently written comments follow GitHub’s access and retention settings.</p>
                </>}
            {connection?.lastSyncedAt && <p className="m-0 text-sm text-muted-foreground">Last synced <DateTime value={connection.lastSyncedAt} />.</p>}
            {connection && connection.needsReviewCount > 0 && <Alert>
                <AlertTitle>Some threads need review</AlertTitle>
                <AlertDescription>{connection.needsReviewCount}{connection.needsReviewCountCapped ? '+' : ''} threads could not be confirmed in GitHub. Check their existing GitHub copies before retrying. uier retains uncertain issue identities to avoid duplicates.</AlertDescription>
            </Alert>}
            {connection?.backfill && <p role="status" className="m-0 text-sm text-muted-foreground">Backfill: {connection.backfill.queued} selected threads queued for delivery.
                {connection.backfill.done && ' Queueing is complete. Delivery continues in the background.'}</p>}
            {connection && <GitHubManagement projectId={projectId} settings={settings} />}
        </div>
    </Section>;
}

function GitHubRepositoryPicker({ projectId, settings }: { projectId: string; settings: Settings }) {
    const id = useId();
    const setup = settings.setup!;
    const [loaded, load, loading] = useActionState(loadGitHubRepositoriesAction, null);
    const [saved, save, saving] = useActionState(saveGitHubRepositoryAction, null);
    const [repositoryId, setRepositoryId] = useState('');
    const [publicConfirmed, setPublicConfirmed] = useState(false);
    const [switchConfirmed, setSwitchConfirmed] = useState(false);
    const repositories = loaded?.ok ? loaded.data.repositories : [];
    const repository = repositories.find(choice => choice.id === repositoryId);
    return <FieldGroup>
        <Field>
            <FieldLabel>Choose a repository</FieldLabel>
            <FieldDescription>Authorized for {setup.accountName}. Load repositories you administer, then choose where shared feedback should go. This authorization expires <DateTime value={setup.expiresAt} />.</FieldDescription>
            <form action={load}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="setupReceipt" value={setup.receipt} />
                <Button type="submit" variant="outline" disabled={loading || saving}>
                    {loading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}Load repositories
                </Button>
            </form>
            <FormMessage state={loaded} />
            {loaded?.ok && repositories.length === 0 && <FieldDescription>No available repositories were found. You need repository admin access and the GitHub App needs Issues write access.</FieldDescription>}
            {loaded?.ok && loaded.data.truncated && <FieldDescription>Only the first 500 repositories are shown. A repository outside this list cannot be selected here.</FieldDescription>}
        </Field>
        {repositories.length > 0 && <form action={save} onReset={event => event.preventDefault()}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="setupReceipt" value={setup.receipt} />
            <input type="hidden" name="repositoryId" value={repositoryId} />
            <FieldGroup>
                <Field data-disabled={saving}>
                    <FieldLabel htmlFor={`${id}-repository`}>Repository</FieldLabel>
                    <Select value={repositoryId} onValueChange={value => { setRepositoryId(value); setPublicConfirmed(false); }} disabled={saving}>
                        <SelectTrigger id={`${id}-repository`}><SelectValue placeholder="Choose a repository" /></SelectTrigger>
                        <SelectContent><SelectGroup>{repositories.map(choice => <SelectItem key={choice.id} value={choice.id}>{choice.fullName} ({choice.private ? 'private' : 'public'})</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                </Field>
                {repository && !repository.private && <>
                    <Alert><AlertTitle>This repository is public</AlertTitle><AlertDescription>Anyone can read the feedback copied to it. Private uier threads are excluded.</AlertDescription></Alert>
                    <Field orientation="horizontal" data-disabled={saving}>
                        <Checkbox id={`${id}-public`} name="confirmPublic" value="true" checked={publicConfirmed} onCheckedChange={value => setPublicConfirmed(value === true)} disabled={saving} />
                        <FieldContent><FieldLabel htmlFor={`${id}-public`}>Allow shared feedback in this public repository</FieldLabel></FieldContent>
                    </Field>
                </>}
                {settings.connection && <Field orientation="horizontal" data-disabled={saving}>
                    <Checkbox id={`${id}-switch`} name="confirmSwitch" value="true" checked={switchConfirmed} onCheckedChange={value => setSwitchConfirmed(value === true)} disabled={saving} />
                    <FieldContent>
                        <FieldLabel htmlFor={`${id}-switch`}>Keep existing GitHub copies</FieldLabel>
                        <FieldDescription>Changing repositories creates new issue identities. Existing issues and comments stay in their previous repository. uier retains their references for later privacy cleanup.</FieldDescription>
                    </FieldContent>
                </Field>}
                <FieldDescription>Saving turns sync on for new shared feedback. Nothing is copied before you save.</FieldDescription>
                <Field>
                    <Button className="w-fit" type="submit" disabled={saving || !repository || (!repository.private && !publicConfirmed) || Boolean(settings.connection && !switchConfirmed)}>
                        {saving && <Spinner data-icon="inline-start" />}Save GitHub repository
                    </Button>
                    <FormMessage state={saved} />
                </Field>
            </FieldGroup>
        </form>}
        <Button asChild className="w-fit" variant="ghost"><a href={`/app/github/connect?project=${encodeURIComponent(projectId)}`}>Start GitHub authorization again</a></Button>
    </FieldGroup>;
}

function GitHubManagement({ projectId, settings }: { projectId: string; settings: Settings }) {
    const router = useRouter();
    const connection = settings.connection!;
    const [result, setResult] = useState<ActionState<{ message: string }>>(null);
    const [pending, startTransition] = useTransition();
    const [confirming, setConfirming] = useState(false);
    function change(operation: 'enable' | 'disable' | 'disconnect' | 'backfill') {
        startTransition(async () => {
            const form = new FormData();
            form.set('projectId', projectId); form.set('operation', operation);
            const next = await manageGitHubAction(null, form);
            setResult(next);
            if (next?.ok) { setConfirming(false); router.refresh(); }
        });
    }
    const canSync = settings.configured && connection.status === 'connected';
    return <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
            {(connection.enabled || canSync) && <Button type="button" variant="outline" disabled={pending} onClick={() => change(connection.enabled ? 'disable' : 'enable')}>
                {pending && <Spinner data-icon="inline-start" />}{connection.enabled ? 'Turn GitHub sync off' : 'Turn GitHub sync on'}
            </Button>}
            {canSync && connection.enabled && <Button type="button" variant="outline" disabled={pending || Boolean(connection.backfill && !connection.backfill.done)} onClick={() => change('backfill')}>Backfill GitHub feedback</Button>}
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={pending}>Disconnect GitHub</Button></AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect GitHub from this project?</AlertDialogTitle>
                        <AlertDialogDescription>Stops future sync from this project. Existing GitHub issues, comments and copies remain. Other projects keep their connections. To remove the app’s wider access, manage its installation in GitHub.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <FormMessage state={result && !result.ok ? result : null} />
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>Keep connected</AlertDialogCancel>
                        <AlertDialogAction variant="outline" disabled={pending} onClick={event => { event.preventDefault(); change('disconnect'); }}>
                            {pending && <Spinner data-icon="inline-start" />}Disconnect GitHub
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
        {canSync && <p className="m-0 text-sm text-muted-foreground">Backfill selects up to 1,000 existing shared threads for this repository. Delivery continues in the background.</p>}
        <FormMessage state={result?.ok ? { ...result, message: result.data.message } : result} />
    </div>;
}
