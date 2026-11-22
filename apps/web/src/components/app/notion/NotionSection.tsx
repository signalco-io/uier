'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useRef, useState, useTransition } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/src/components/ui/alert-dialog';
import { Badge } from '@/src/components/ui/badge';
import { cn } from 'cn';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { NotionMapping, NotionSchema, NotionSettingsView } from '@/src/lib/integrations/notion';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { BackfillDetail, ConnectionControls, ConnectionNote } from '../integrations/ConnectionControls';
import { ChangeDestinationButton, DestinationPanel, useDestinationForm } from '../integrations/DestinationForm';
import { IntegrationDetail, IntegrationDetails } from '../integrations/IntegrationDetails';
import { IntegrationTitle } from '../integrations/IntegrationLogo';
import { notionStatus } from '../integrations/projectIntegrations';
import { Section } from '../PageHeader';
import { loadNotionDataSourcesAction, loadNotionSchemaAction, manageNotionAction, saveNotionMappingAction } from './actions';

type Sources = Awaited<ReturnType<typeof loadNotionDataSourcesAction>>;
type LoadedSchema = Awaited<ReturnType<typeof loadNotionSchemaAction>>;
type SchemaOptions = Extract<NonNullable<LoadedSchema>, { ok: true }>['data'];
const outcomes: Record<string, string> = {
    connected: 'Notion is connected.',
    denied: 'The Notion connection was canceled. You can connect again.',
    failed: 'Notion could not complete the connection. Try connecting again.',
    unavailable: 'Notion is unavailable right now. Try again later.'
};
const problems: Record<string, string> = {
    mapping_invalid: 'A mapped field changed in Notion. Choose Change database, then save the mapping again.',
    data_source_missing: 'The saved database is unavailable. Share it with the Notion connection or choose another database.',
    insufficient_capabilities: 'Notion needs permission to read, insert and update content. Check the connection in Notion, then load the fields again.',
    cleanup_blocked: 'Some copied content could not be removed. Restore access to its previous Notion workspace or database, then save its mapping to retry cleanup.',
    request_blocked: 'Notion blocked this connection’s requests. Check its access in Notion before turning sync on again.'
};

/**
 * Notion for a project, in the order of Slack's card: the status badge, where pages go, the Sync switch,
 * then the rare actions under More options. Without a connection it is one button.
 */
export function NotionSection({ projectId, settings, outcome }: { projectId: string; settings: NotionSettingsView; outcome?: string }) {
    const { t } = useAppI18n();
    const connected = settings.status !== 'not_connected';
    const notice = outcome && Object.hasOwn(outcomes, outcome) && (outcome !== 'connected' || connected) ? outcomes[outcome] : undefined;
    const status = notionStatus(settings);
    const connectHref = `/app/notion/connect?project=${encodeURIComponent(projectId)}`;
    return <Section id="notion" title={<IntegrationTitle provider="notion" name="Notion" />} description={t("Create one Notion page for each shared feedback thread. uier keeps its fields, discussion and screenshot up to date.")}
        actions={<Badge variant="secondary">{t(status)}</Badge>}>
        <div className="flex flex-col gap-5">
            {notice && <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>}
            {!settings.configured && <p className="m-0 text-sm text-muted-foreground">{t("Notion is unavailable on this deployment. A site administrator needs to configure it.")}</p>}
            {connected ? <NotionConnection projectId={projectId} settings={settings} connectHref={connectHref} />
                : settings.configured && <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>{t("Connect Notion")}<ArrowUpRight data-icon="inline-end" /></a>}
        </div>
    </Section>;
}

function NotionConnection({ projectId, settings, connectHref }: { projectId: string; settings: NotionSettingsView; connectHref: string }) {
    const { t } = useAppI18n();
    const needsReconnect = settings.status === 'needs_reconnect';
    const usable = settings.configured && !needsReconnect;
    const canSync = settings.configured && Boolean(settings.dataSourceId) && settings.status === 'connected';
    const problem = usable && settings.statusCode && Object.hasOwn(problems, settings.statusCode) ? problems[settings.statusCode] : undefined;

    // The database and its field mapping: open until a database is saved, then behind Change database
    const form = useDestinationForm(Boolean(settings.dataSourceId));
    const [, startLoad] = useTransition();
    const [sources, loadSources, loadingSources] = useActionState(loadNotionDataSourcesAction, null);
    const [fields, loadFields, loadingFields] = useActionState(loadNotionSchemaAction, null);
    const [saved, save, saving] = useActionState(async (previous: ActionState, data: FormData) => {
        const response = await saveNotionMappingAction(previous, data);
        if (response?.ok) form.close();
        return response;
    }, null);
    function toggleForm() {
        if (saving) return;
        if (form.editing) return form.close();
        form.edit();
        // Asking to change the database is the request to read the databases and the saved one's fields
        const source = new FormData(); source.set('projectId', projectId); source.set('dataSourceId', settings.dataSourceId!);
        startLoad(() => { loadSources(source); loadFields(source); });
    }

    return <>
        {problem && <Alert><AlertTitle>{t("Check the Notion connection")}</AlertTitle><AlertDescription>{t(problem)}</AlertDescription></Alert>}
        {settings.needsReviewCount > 0 && <Alert><AlertTitle>{t("Some threads need review")}</AlertTitle>
            <AlertDescription>{settings.needsReviewCount}{settings.needsReviewCountCapped ? '+' : ''} {t("threads could not be confirmed in Notion. Check their existing copies before retrying. uier retains uncertain page identities to avoid duplicates.")}</AlertDescription>
        </Alert>}

        <IntegrationDetails ref={form.details}>
            {settings.notionWorkspaceName && <IntegrationDetail term={t("Workspace")}>{settings.notionWorkspaceName}</IntegrationDetail>}
            {settings.dataSourceId && <>
                <IntegrationDetail term={t("Database")} action={usable && <ChangeDestinationButton form={form} onClick={toggleForm}>{t("Change database")}</ChangeDestinationButton>}>
                    {settings.dataSourceName ?? t('Saved database')}
                </IntegrationDetail>
                <IntegrationDetail term={t("Status values")}>
                    {settings.mapping?.status ? `${settings.mapping.status.open} / ${settings.mapping.status.done}` : t("Not mapped")}
                </IntegrationDetail>
            </>}
            {settings.lastSyncedAt && <IntegrationDetail term={t("Last synced")}><DateTime value={settings.lastSyncedAt} /></IntegrationDetail>}
            {settings.pausedUntil && <IntegrationDetail term={t("Requests resume")}><DateTime value={settings.pausedUntil} /></IntegrationDetail>}
            <BackfillDetail backfill={settings.backfill} />
        </IntegrationDetails>

        {settings.configured && needsReconnect && <a href={connectHref} className={cn(buttonVariants(), 'w-fit')}>{t("Reconnect Notion")}<ArrowUpRight data-icon="inline-end" /></a>}

        {usable && form.open && <DestinationPanel form={form}>
            <NotionDestination projectId={projectId} settings={settings} sources={sources} loadSources={loadSources} loadingSources={loadingSources}
                fields={fields} loadFields={loadFields} loadingFields={loadingFields}
                save={save} saving={saving} error={saved && !saved.ok ? saved : null} onCancel={settings.dataSourceId ? form.close : undefined} />
        </DestinationPanel>}
        {!form.open && <FormMessage state={saved} />}

        <ConnectionControls projectId={projectId} manage={manageNotionAction}
            sync={settings.enabled || canSync ? { checked: settings.enabled } : undefined}
            backfill={canSync && settings.enabled ? { label: t("Backfill existing feedback"), queueing: Boolean(settings.backfill && !settings.backfill.done) } : undefined}
            reconnect={usable ? { label: t("Reconnect Notion"), href: connectHref } : undefined}
            disconnect={{ label: t("Disconnect Notion"), title: t("Disconnect Notion from this project?"),
                description: t("Stops future sync from this project. Existing pages and files remain in Notion. Other projects keep their connections.") }}>
            {canSync && <ConnectionNote>{t("Backfill selects up to 1,000 existing shared threads for this Notion destination. New feedback syncs automatically while sync is on.")}</ConnectionNote>}
            <ConnectionNote>{t("Private feedback is never sent. Making shared feedback private or deleting it clears and trashes reachable Notion pages. Notion’s history, files and other retained copies follow its own settings.")}</ConnectionNote>
        </ConnectionControls>
    </>;
}

/** The database, then its fields. The lists are read from Notion only when asked for */
function NotionDestination({ projectId, settings, sources, loadSources, loadingSources, fields, loadFields, loadingFields, save, saving, error, onCancel }: {
    projectId: string;
    settings: NotionSettingsView;
    sources: Sources;
    loadSources: (form: FormData) => void;
    loadingSources: boolean;
    fields: LoadedSchema;
    loadFields: (form: FormData) => void;
    loadingFields: boolean;
    save: (form: FormData) => void;
    saving: boolean;
    error: ActionState;
    onCancel?: () => void;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const [, startLoad] = useTransition();
    const [sourceId, setSourceId] = useState(settings.dataSourceId ?? '');
    const choices = sources?.ok ? sources.data : [];
    const allChoices = settings.dataSourceId && !choices.some(item => item.id === settings.dataSourceId)
        ? [{ id: settings.dataSourceId, name: settings.dataSourceName ?? t('Saved database') }, ...choices] : choices;
    const options = fields?.ok && fields.data.dataSourceId === sourceId ? fields.data : undefined;
    const busy = loadingSources || loadingFields || saving;
    return <FieldGroup>
        <Field>
            <FieldLabel>{t("Notion databases")}</FieldLabel>
            <FieldDescription>{t("Load databases shared with this Notion connection. These actions only read your choices.")}</FieldDescription>
            <form action={loadSources}><input type="hidden" name="projectId" value={projectId} />
                <Button type="submit" variant={sources?.ok || settings.dataSourceId ? "outline" : "default"} disabled={busy}>
                    {loadingSources ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}{t("Load databases")}{' '}</Button>
            </form>
            <FormMessage state={sources} />
            {sources?.ok && !sources.data.length && <FieldDescription>{t("No databases are available. Share a database with this connection in Notion, then load again.")}</FieldDescription>}
            {sources?.ok && sources.data.length >= 500 && <FieldDescription>{t("Only the first 500 databases are shown.")}</FieldDescription>}
        </Field>
        {allChoices.length > 0 && <form onSubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget); startLoad(() => loadFields(data));
        }}>
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="dataSourceId" value={sourceId} />
            <FieldGroup>
                <Field><FieldLabel htmlFor={`${id}-source`}>{t("Database")}</FieldLabel>
                    <Select items={allChoices.map(item => ({ value: item.id, label: item.name }))} value={sourceId} onValueChange={value => value !== null && setSourceId(value)} disabled={loadingFields || saving}>
                        <SelectTrigger id={`${id}-source`}><SelectValue placeholder={t("Choose a database")} /></SelectTrigger>
                        <SelectContent><SelectGroup>{allChoices.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>{t("For a database with multiple data sources, each source appears as a separate choice.")}</FieldDescription>
                </Field>
                <div className="flex flex-col items-start gap-3"><Button type="submit" variant="outline" disabled={!sourceId || busy}>
                    {loadingFields && <Spinner data-icon="inline-start" />}{t("Load fields")}</Button><FormMessage state={fields} /></div>
            </FieldGroup>
        </form>}
        {options ? <NotionMappingForm key={`${options.dataSourceId}:${JSON.stringify(options.schema)}`} projectId={projectId} settings={settings} options={options}
            save={save} pending={saving} error={error} onCancel={onCancel} />
            : onCancel && <Button type="button" variant="ghost" className="w-fit" disabled={saving} onClick={onCancel}>{t("Cancel")}</Button>}
    </FieldGroup>;
}

type MappingKey = Exclude<keyof NotionMapping, 'status' | 'reviewSession'>;
const mappedFields: { key: MappingKey; label: string; type: string; required?: boolean }[] = [
    { key: 'title', label: 'Title (required)', type: 'title', required: true }, { key: 'uierId', label: 'uier id (required)', type: 'rich_text', required: true },
    { key: 'kind', label: 'Kind', type: 'select' }, { key: 'environment', label: 'Environment', type: 'select' },
    { key: 'link', label: 'Link to feedback', type: 'url' }, { key: 'page', label: 'Reviewed page', type: 'url' },
    { key: 'created', label: 'Created date', type: 'date' }, { key: 'assignee', label: 'Assignee name', type: 'rich_text' }, { key: 'screenshot', label: 'Screenshot file', type: 'files' }
];
function initialMapping(options: SchemaOptions, settings: NotionSettingsView) {
    const source = settings.dataSourceId === options.dataSourceId && settings.mapping ? settings.mapping : options.mapping;
    const result: NotionMapping = { title: '', uierId: '' };
    for (const field of mappedFields) {
        const value = source[field.key]; if (value && options.schema[value]?.type === field.type) result[field.key] = value;
    }
    if (source.status && options.schema[source.status.property]?.type === source.status.type) result.status = source.status;
    if (source.reviewSession && options.schema[source.reviewSession.property]?.type === source.reviewSession.type) result.reviewSession = source.reviewSession;
    return result;
}
/** The saved mapping comes back in the form when its database is the saved one */
function NotionMappingForm({ projectId, settings, options, save, pending, error, onCancel }: {
    projectId: string; settings: NotionSettingsView; options: SchemaOptions; save: (form: FormData) => void; pending: boolean; error: ActionState; onCancel?: () => void;
}) {
    const { t } = useAppI18n();
    const id = useId(); const form = useRef<HTMLFormElement>(null); const confirmed = useRef(false);
    const [mapping, setMapping] = useState(() => initialMapping(options, settings));
    const [confirming, setConfirming] = useState(false);
    const chosen = [...mappedFields.map(field => mapping[field.key]).filter(Boolean), mapping.status?.property, mapping.reviewSession?.property].filter(Boolean);
    const duplicates = new Set(chosen.filter((value, index) => chosen.indexOf(value) !== index));
    const invalid = !mapping.title || !mapping.uierId || duplicates.size > 0 || Boolean(mapping.status && (!mapping.status.open || !mapping.status.done || mapping.status.open === mapping.status.done));
    const statusField = mapping.status && options.schema[mapping.status.property];
    const chooseStatus = (value: string) => setMapping(current => {
        if (value === 'none') { const { status: _status, ...rest } = current; return rest; }
        const field = options.schema[value]!; const names = field.options ?? [];
        return { ...current, status: { property: value, type: field.type as 'status' | 'select', open: names.includes('Open') ? 'Open' : names[0] ?? '', done: names.includes('Done') ? 'Done' : names[1] ?? '' } };
    });
    return <>
        <form ref={form} action={save} onSubmit={event => {
            if (settings.dataSourceId && settings.dataSourceId !== options.dataSourceId && !confirmed.current) { event.preventDefault(); setConfirming(true); }
        }}>
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="dataSourceId" value={options.dataSourceId} />
            <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
            <FieldGroup>
                <FieldSet disabled={pending}><FieldLegend>{t("Map Notion fields")}</FieldLegend>
                    <FieldDescription>{t("Choose existing fields of the matching type. The uier id uses a separate rich text field to prevent duplicate pages. Optional fields can stay unmapped.")}</FieldDescription>
                    <FieldGroup>{mappedFields.map(field => <PropertyChoice key={field.key} id={`${id}-${field.key}`} label={t(field.label)} schema={options.schema}
                        types={[field.type]} value={mapping[field.key] ?? ''} required={field.required} disabled={pending} invalid={duplicates.has(mapping[field.key] ?? '')}
                        onChange={value => setMapping(current => ({ ...current, [field.key]: value === 'none' ? '' : value }))} />)}
                        <PropertyChoice id={`${id}-status`} label={t("Status")} schema={options.schema} types={['status', 'select']} value={mapping.status?.property ?? ''}
                            disabled={pending} invalid={duplicates.has(mapping.status?.property ?? '')} onChange={chooseStatus} />
                        <PropertyChoice id={`${id}-review-session`} label={t("Review session")} schema={options.schema} types={['rich_text', 'select']}
                            value={mapping.reviewSession?.property ?? ''} disabled={pending} invalid={duplicates.has(mapping.reviewSession?.property ?? '')}
                            onChange={value => setMapping(current => ({ ...current, reviewSession: value === 'none' ? undefined
                                : { property: value, type: options.schema[value]!.type as 'rich_text' | 'select' } }))} />
                        {mapping.status && <>
                            {(['open', 'done'] as const).map(value => <Field key={value} data-invalid={mapping.status!.open === mapping.status!.done}>
                                <FieldLabel htmlFor={`${id}-${value}`}>{value === 'open' ? t("Status for open feedback") : t("Status for done feedback")}</FieldLabel>
                                {statusField && statusField.type === 'status' ? <Select value={mapping.status![value]} disabled={pending}
                                    onValueChange={name => name !== null && setMapping(current => ({ ...current, status: { ...current.status!, [value]: name } }))}>
                                    <SelectTrigger id={`${id}-${value}`} aria-invalid={mapping.status!.open === mapping.status!.done}><SelectValue placeholder={t("Choose a status")} /></SelectTrigger>
                                    <SelectContent><SelectGroup>{statusField.options?.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectGroup></SelectContent>
                                </Select> : <Input id={`${id}-${value}`} value={mapping.status![value]} maxLength={100} disabled={pending}
                                    aria-invalid={mapping.status!.open === mapping.status!.done} onChange={event => setMapping(current => ({ ...current, status: { ...current.status!, [value]: event.target.value } }))} />}
                            </Field>)}
                            <FieldDescription>{t("Choose different names for open and done feedback. A select field can create these choices; commas are not supported.")}</FieldDescription>
                        </>}
                    </FieldGroup>
                </FieldSet>
                {(!mapping.title || !mapping.uierId) && <Alert><AlertTitle>{t("Required fields are missing")}</AlertTitle><AlertDescription>{t("Choose a title field and a rich text field for the uier id. Add missing fields in Notion, then load the fields again.")}</AlertDescription></Alert>}
                {duplicates.size > 0 && <Alert><AlertTitle>{t("Choose separate fields")}</AlertTitle><AlertDescription>{t("A Notion field can only be mapped once.")}</AlertDescription></Alert>}
                <FieldDescription>{t("Saving turns sync on for shared feedback, including screenshots. Existing Notion pages stay in their previous database when the destination changes.")}</FieldDescription>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                        <Button type="submit" disabled={pending || invalid}>{pending && <Spinner data-icon="inline-start" />}{t("Save Notion mapping")}</Button>
                        {onCancel && <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>{t("Cancel")}</Button>}
                    </div>
                    <FormMessage state={error} />
                </div>
            </FieldGroup>
        </form>
        <AlertDialog open={confirming} onOpenChange={setConfirming}><AlertDialogContent><AlertDialogHeader>
            <AlertDialogTitle>{t("Switch Notion database?")}</AlertDialogTitle><AlertDialogDescription>{t("Future changes create pages in")}{' '}{options.dataSourceName}{t(". Existing pages stay in the previous database. Backfill can queue existing shared feedback for the new destination.")}</AlertDialogDescription>
        </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>{t("Keep current database")}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => { confirmed.current = true; setConfirming(false); form.current?.requestSubmit(); confirmed.current = false; }}>{t("Switch database")}</AlertDialogAction>
        </AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>;
}
function PropertyChoice({ id, label, schema, types, value, onChange, required = false, disabled, invalid }: {
    id: string; label: string; schema: NotionSchema; types: string[]; value: string; onChange: (value: string) => void; required?: boolean; disabled: boolean; invalid?: boolean;
}) {
    const { t } = useAppI18n();
    const choices = Object.entries(schema).filter(([, field]) => types.includes(field.type));
    const items = [{ value: 'none', label: required ? t("Choose a field") : t("Not mapped") }, ...choices.map(([key, field]) => ({ value: key, label: field.name }))];
    return <Field data-disabled={disabled} data-invalid={invalid}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Select items={items} value={value || 'none'} onValueChange={next => next !== null && onChange(next)} disabled={disabled || !choices.length}>
            <SelectTrigger id={id} aria-invalid={invalid}><SelectValue placeholder={t("Choose a field")} /></SelectTrigger>
            <SelectContent><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        {!choices.length && <FieldDescription>{t("No")}{' '}{types.join(' or ')} {t("fields are available.")}</FieldDescription>}
    </Field>;
}
