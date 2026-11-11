'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Badge } from '@/src/components/ui/badge';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { getGitHubSettings } from '@/src/lib/integrations/github';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { IntegrationTitle } from '../integrations/IntegrationLogo';
import { gitHubStatus } from '../integrations/projectIntegrations';
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
    const { t } = useAppI18n();
    const connection = settings.connection;
    const publicConfirmationRequired = connection?.statusCode === 'public_confirmation_required';
    const notice = outcome && Object.hasOwn(outcomes, outcome) ? outcomes[outcome] : undefined;
    const status = gitHubStatus(settings, outcome);
    return <Section id="github" title={<IntegrationTitle provider="github" name="GitHub" />} description={t("Create one GitHub issue for each shared feedback thread. uier keeps the issue and its discussion up to date.")}
        actions={<Badge variant="secondary">{t(status)}</Badge>}>
        <div className="flex flex-col gap-5">
            {notice && (outcome === 'pending' ? <Alert role="status">
                <AlertTitle>{t("Waiting for GitHub approval")}</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
            </Alert> : <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>)}
            {!settings.configured ? <p className="m-0 text-sm text-muted-foreground">{t("GitHub is unavailable on this deployment. A site administrator needs to configure it.")}</p>
                : <>
                    {settings.setup ? <GitHubRepositoryPicker key={settings.setup.receipt} projectId={projectId} settings={settings} />
                        : <a href={`/app/github/connect?project=${encodeURIComponent(projectId)}`} className={cn(buttonVariants({ variant: connection ? "outline" : "default" }), 'w-fit')}>
                            <ArrowUpRight data-icon="inline-start" />{connection ? t("Reconnect GitHub") : t("Connect GitHub")}
                        </a>}
                    {!settings.setup && settings.installations.length > 0 && <div className="flex flex-col gap-2">
                        <p className="m-0 text-sm text-muted-foreground">{t("Or use an installation already connected to this workspace. GitHub verifies your account before you choose a repository.")}</p>
                        {settings.installations.map(installation => <a key={installation.id} href={`/app/github/connect?project=${encodeURIComponent(projectId)}&installation=${encodeURIComponent(installation.id)}`} className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')}>
                            {t("Use")}{' '}{installation.accountName} {t("installation")}{' '}</a>)}
                    </div>}
                    {connection && <>
                        <p className="m-0 text-sm">{t("Repository:")}{' '}{connection.repositoryName} ({publicConfirmationRequired ? t("public access needs confirmation") : connection.repositoryVisibility}).</p>
                        {publicConfirmationRequired && <Alert>
                            <AlertTitle>{t("Confirm public repository access")}</AlertTitle>
                            <AlertDescription>{t("This repository changed from private to public. Sync is paused. Existing copies may be public. Reconnect GitHub and confirm the public repository before copying more feedback.")}</AlertDescription>
                        </Alert>}
                        {connection.repositoryVisibility === 'public' && <Alert>
                            <AlertTitle>{t("Public repository")}</AlertTitle>
                            <AlertDescription>{t("Anyone can read the feedback copied to this repository. Private uier threads are excluded.")}</AlertDescription>
                        </Alert>}
                        {connection.status !== 'connected' && !publicConfirmationRequired && <p className="m-0 text-sm text-muted-foreground">{t("GitHub access needs attention. Check the app’s installation and repository access in GitHub, then reconnect.")}</p>}
                    </>}
                    <p className="m-0 text-sm text-muted-foreground">{t("The GitHub App’s installation controls repository access. Turning sync on copies new shared feedback; existing threads need a separate backfill. Private threads and the public showcase are excluded.")}</p>
                    <p className="m-0 text-sm text-muted-foreground">{t("Screenshots stay as protected uier links. GitHub copies, edit histories, notifications and independently written comments follow GitHub’s access and retention settings.")}</p>
                </>}
            {connection?.lastSyncedAt && <p className="m-0 text-sm text-muted-foreground">{t("Last synced")}{' '}<DateTime value={connection.lastSyncedAt} />.</p>}
            {connection && connection.needsReviewCount > 0 && <Alert>
                <AlertTitle>{t("Some threads need review")}</AlertTitle>
                <AlertDescription>{connection.needsReviewCount}{connection.needsReviewCountCapped ? '+' : ''} {t("threads could not be confirmed in GitHub. Check their existing GitHub copies before retrying. uier retains uncertain issue identities to avoid duplicates.")}</AlertDescription>
            </Alert>}
            {connection?.backfill && <p role="status" className="m-0 text-sm text-muted-foreground">{t("Backfill:")}{' '}{connection.backfill.queued} {t("selected threads queued for delivery.")}{' '}{connection.backfill.done && <>{t("Queueing is complete.")}{' '}{t("Delivery continues in the background.")}</>}</p>}
            {connection && <GitHubManagement projectId={projectId} settings={settings} />}
        </div>
    </Section>;
}

function GitHubRepositoryPicker({ projectId, settings }: { projectId: string; settings: Settings }) {
    const { t } = useAppI18n();
    const id = useId();
    const setup = settings.setup!;
    const [loaded, load, loading] = useActionState(loadGitHubRepositoriesAction, null);
    const [saved, save, saving] = useActionState(saveGitHubRepositoryAction, null);
    const [repositoryId, setRepositoryId] = useState('');
    const [publicConfirmed, setPublicConfirmed] = useState(false);
    const [switchConfirmed, setSwitchConfirmed] = useState(false);
    const repositories = loaded?.ok ? loaded.data.repositories : [];
    const repositoryItems = repositories.map(choice => ({ value: choice.id, label: t("{value1} ({value2})", { value1: choice.fullName, value2: choice.private ? 'private' : 'public' }) }));
    const repository = repositories.find(choice => choice.id === repositoryId);
    return <FieldGroup>
        <Field>
            <FieldLabel>{t("Choose a repository")}</FieldLabel>
            <FieldDescription>{t("Authorized for")}{' '}{setup.accountName}{t(". Load repositories you administer, then choose where shared feedback should go. This authorization expires")}{' '}<DateTime value={setup.expiresAt} />.</FieldDescription>
            <form action={load}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="setupReceipt" value={setup.receipt} />
                <Button type="submit" variant="outline" disabled={loading || saving}>
                    {loading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}{t("Load repositories")}{' '}</Button>
            </form>
            <FormMessage state={loaded} />
            {loaded?.ok && repositories.length === 0 && <FieldDescription>{t("No available repositories were found. You need repository admin access and the GitHub App needs Issues write access.")}</FieldDescription>}
            {loaded?.ok && loaded.data.truncated && <FieldDescription>{t("Only the first 500 repositories are shown. A repository outside this list cannot be selected here.")}</FieldDescription>}
        </Field>
        {repositories.length > 0 && <form action={save} onReset={event => event.preventDefault()}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="setupReceipt" value={setup.receipt} />
            <input type="hidden" name="repositoryId" value={repositoryId} />
            <FieldGroup>
                <Field data-disabled={saving}>
                    <FieldLabel htmlFor={`${id}-repository`}>{t("Repository")}</FieldLabel>
                    <Select items={repositoryItems} value={repositoryId} onValueChange={value => { if (value === null) return; setRepositoryId(value); setPublicConfirmed(false); }} disabled={saving}>
                        <SelectTrigger id={`${id}-repository`}><SelectValue placeholder={t("Choose a repository")} /></SelectTrigger>
                        <SelectContent><SelectGroup>{repositoryItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                </Field>
                {repository && !repository.private && <>
                    <Alert><AlertTitle>{t("This repository is public")}</AlertTitle><AlertDescription>{t("Anyone can read the feedback copied to it. Private uier threads are excluded.")}</AlertDescription></Alert>
                    <Field orientation="horizontal" data-disabled={saving}>
                        <Checkbox id={`${id}-public`} name="confirmPublic" value="true" checked={publicConfirmed} onCheckedChange={value => setPublicConfirmed(value === true)} disabled={saving} />
                        <FieldContent><FieldLabel htmlFor={`${id}-public`}>{t("Allow shared feedback in this public repository")}</FieldLabel></FieldContent>
                    </Field>
                </>}
                {settings.connection && <Field orientation="horizontal" data-disabled={saving}>
                    <Checkbox id={`${id}-switch`} name="confirmSwitch" value="true" checked={switchConfirmed} onCheckedChange={value => setSwitchConfirmed(value === true)} disabled={saving} />
                    <FieldContent>
                        <FieldLabel htmlFor={`${id}-switch`}>{t("Keep existing GitHub copies")}</FieldLabel>
                        <FieldDescription>{t("Changing repositories creates new issue identities. Existing issues and comments stay in their previous repository. uier retains their references for later privacy cleanup.")}</FieldDescription>
                    </FieldContent>
                </Field>}
                <FieldDescription>{t("Saving turns sync on for new shared feedback. Nothing is copied before you save.")}</FieldDescription>
                <Field>
                    <Button className="w-fit" type="submit" disabled={saving || !repository || (!repository.private && !publicConfirmed) || Boolean(settings.connection && !switchConfirmed)}>
                        {saving && <Spinner data-icon="inline-start" />}{t("Save GitHub repository")}{' '}</Button>
                    <FormMessage state={saved} />
                </Field>
            </FieldGroup>
        </form>}
        <a href={`/app/github/connect?project=${encodeURIComponent(projectId)}`} className={cn(buttonVariants({ variant: 'ghost' }), 'w-fit')}>{t("Start GitHub authorization again")}</a>
    </FieldGroup>;
}

function GitHubManagement({ projectId, settings }: { projectId: string; settings: Settings }) {
    const { t } = useAppI18n();
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
                {pending && <Spinner data-icon="inline-start" />}{connection.enabled ? t("Turn GitHub sync off") : t("Turn GitHub sync on")}
            </Button>}
            {canSync && connection.enabled && <Button type="button" variant="outline" disabled={pending || Boolean(connection.backfill && !connection.backfill.done)} onClick={() => change('backfill')}>{t("Backfill GitHub feedback")}</Button>}
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogTrigger render={<Button type="button" variant="outline" disabled={pending} />}>{t("Disconnect GitHub")}</AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("Disconnect GitHub from this project?")}</AlertDialogTitle>
                        <AlertDialogDescription>{t("Stops future sync from this project. Existing GitHub issues, comments and copies remain. Other projects keep their connections. To remove the app’s wider access, manage its installation in GitHub.")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <FormMessage state={result && !result.ok ? result : null} />
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>{t("Keep connected")}</AlertDialogCancel>
                        <AlertDialogAction variant="outline" disabled={pending} onClick={() => change('disconnect')}>
                            {pending && <Spinner data-icon="inline-start" />}{t("Disconnect GitHub")}{' '}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
        {canSync && <p className="m-0 text-sm text-muted-foreground">{t("Backfill selects up to 1,000 existing shared threads for this repository. Delivery continues in the background.")}</p>}
        <FormMessage state={result?.ok ? { ...result, message: result.data.message } : result} />
    </div>;
}
