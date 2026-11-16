'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Badge } from '@/src/components/ui/badge';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { getGitHubSettings } from '@/src/lib/integrations/github';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { BackfillDetail, ConnectionControls, ConnectionNote } from '../integrations/ConnectionControls';
import { DestinationPanel } from '../integrations/DestinationForm';
import { IntegrationDetail, IntegrationDetails } from '../integrations/IntegrationDetails';
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

/**
 * GitHub for a project, in the order of Slack's card: the status badge, the repository, the Sync switch, then
 * the rare actions under More options. GitHub asks for an authorization before a repository can be chosen,
 * so Change repository goes there and comes back with the repository picker.
 */
export function GitHubSection({ projectId, settings, outcome }: { projectId: string; settings: Settings; outcome?: string }) {
    const { t } = useAppI18n();
    const connection = settings.connection;
    const notice = outcome && Object.hasOwn(outcomes, outcome) ? outcomes[outcome] : undefined;
    const status = gitHubStatus(settings, outcome);
    const connectHref = `/app/github/connect?project=${encodeURIComponent(projectId)}`;
    return <Section id="github" title={<IntegrationTitle provider="github" name="GitHub" />} description={t("Create one GitHub issue for each shared feedback thread. uier keeps the issue and its discussion up to date.")}
        actions={<Badge variant="secondary">{t(status)}</Badge>}>
        <div className="flex flex-col gap-5">
            {notice && (outcome === 'pending' ? <Alert role="status">
                <AlertTitle>{t("Waiting for GitHub approval")}</AlertTitle>
                <AlertDescription>{notice}</AlertDescription>
            </Alert> : <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>)}
            {!settings.configured && <p className="m-0 text-sm text-muted-foreground">{t("GitHub is unavailable on this deployment. A site administrator needs to configure it.")}</p>}
            {connection ? <GitHubConnection projectId={projectId} settings={settings} connectHref={connectHref} />
                : settings.configured && (settings.setup ? <DestinationPanel><GitHubRepositoryPicker key={settings.setup.receipt} projectId={projectId} settings={settings} /></DestinationPanel>
                    : <>
                        <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>{t("Connect GitHub")}<ArrowUpRight data-icon="inline-end" /></a>
                        <GitHubInstallations projectId={projectId} settings={settings} />
                    </>)}
        </div>
    </Section>;
}

/** The installations other projects of the workspace already use: a shorter way to the repository picker */
function GitHubInstallations({ projectId, settings }: { projectId: string; settings: Settings }) {
    const { t } = useAppI18n();
    if (!settings.installations.length) return null;
    return <div className="flex flex-col gap-2">
        <p className="m-0 text-sm text-muted-foreground">{t("Or use an installation already connected to this workspace. GitHub verifies your account before you choose a repository.")}</p>
        {settings.installations.map(installation => <a key={installation.id} href={`/app/github/connect?project=${encodeURIComponent(projectId)}&installation=${encodeURIComponent(installation.id)}`} className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')}>
            {t("Use")}{' '}{installation.accountName} {t("installation")}{' '}</a>)}
    </div>;
}

function GitHubConnection({ projectId, settings, connectHref }: { projectId: string; settings: Settings; connectHref: string }) {
    const { t } = useAppI18n();
    const connection = settings.connection!;
    const publicConfirmationRequired = connection.statusCode === 'public_confirmation_required';
    const healthy = connection.status === 'connected';
    const canSync = settings.configured && healthy;
    // A new authorization is how the repository changes and how lost access comes back; one that is open shows its picker
    const canAuthorize = settings.configured && !settings.setup;
    return <>
        {publicConfirmationRequired && <Alert>
            <AlertTitle>{t("Confirm public repository access")}</AlertTitle>
            <AlertDescription>{t("This repository changed from private to public. Sync is paused. Existing copies may be public. Reconnect GitHub and confirm the public repository before copying more feedback.")}</AlertDescription>
        </Alert>}
        {connection.repositoryVisibility === 'public' && <Alert>
            <AlertTitle>{t("Public repository")}</AlertTitle>
            <AlertDescription>{t("Anyone can read the feedback copied to this repository. Private uier threads are excluded.")}</AlertDescription>
        </Alert>}
        {connection.needsReviewCount > 0 && <Alert>
            <AlertTitle>{t("Some threads need review")}</AlertTitle>
            <AlertDescription>{connection.needsReviewCount}{connection.needsReviewCountCapped ? '+' : ''} {t("threads could not be confirmed in GitHub. Check their existing GitHub copies before retrying. uier retains uncertain issue identities to avoid duplicates.")}</AlertDescription>
        </Alert>}
        {!healthy && !publicConfirmationRequired && <p className="m-0 text-sm text-muted-foreground">{t("GitHub access needs attention. Check the app’s installation and repository access in GitHub, then reconnect.")}</p>}

        <IntegrationDetails>
            <IntegrationDetail term={t("Repository")} action={canAuthorize && healthy && <a href={connectHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t("Change repository")}<ArrowUpRight data-icon="inline-end" /></a>}>
                {connection.repositoryName} ({publicConfirmationRequired ? t("public access needs confirmation") : connection.repositoryVisibility})
            </IntegrationDetail>
            {connection.lastSyncedAt && <IntegrationDetail term={t("Last synced")}><DateTime value={connection.lastSyncedAt} /></IntegrationDetail>}
            <BackfillDetail backfill={connection.backfill} />
        </IntegrationDetails>

        {canAuthorize && !healthy && <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>{t("Reconnect GitHub")}<ArrowUpRight data-icon="inline-end" /></a>}
        {settings.configured && settings.setup && <DestinationPanel><GitHubRepositoryPicker key={settings.setup.receipt} projectId={projectId} settings={settings} /></DestinationPanel>}

        <ConnectionControls projectId={projectId} manage={manageGitHubAction}
            sync={connection.enabled || canSync ? { checked: connection.enabled } : undefined}
            backfill={canSync && connection.enabled ? { label: t("Backfill GitHub feedback"), queueing: Boolean(connection.backfill && !connection.backfill.done) } : undefined}
            reconnect={canAuthorize && healthy ? { label: t("Reconnect GitHub"), href: connectHref } : undefined}
            disconnect={{ label: t("Disconnect GitHub"), title: t("Disconnect GitHub from this project?"),
                description: t("Stops future sync from this project. Existing GitHub issues, comments and copies remain. Other projects keep their connections. To remove the app’s wider access, manage its installation in GitHub.") }}>
            {canAuthorize && <GitHubInstallations projectId={projectId} settings={settings} />}
            {canSync && <ConnectionNote>{t("Backfill selects up to 1,000 existing shared threads for this repository. Delivery continues in the background.")}</ConnectionNote>}
            <ConnectionNote>{t("The GitHub App’s installation controls repository access. Turning sync on copies new shared feedback; existing threads need a separate backfill. Private threads and the public showcase are excluded.")}</ConnectionNote>
            <ConnectionNote>{t("Screenshots stay as protected uier links. GitHub copies, edit histories, notifications and independently written comments follow GitHub’s access and retention settings.")}</ConnectionNote>
        </ConnectionControls>
    </>;
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
                <Button type="submit" variant={loaded?.ok ? "outline" : "default"} disabled={loading || saving}>
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
                <div className="flex flex-col items-start gap-3">
                    <Button type="submit" disabled={saving || !repository || (!repository.private && !publicConfirmed) || Boolean(settings.connection && !switchConfirmed)}>
                        {saving && <Spinner data-icon="inline-start" />}{t("Save GitHub repository")}{' '}</Button>
                    <FormMessage state={saved} />
                </div>
            </FieldGroup>
        </form>}
        <a href={`/app/github/connect?project=${encodeURIComponent(projectId)}`} className={cn(buttonVariants({ variant: 'ghost' }), 'w-fit')}>{t("Start GitHub authorization again")}</a>
    </FieldGroup>;
}
