'use client';

import { useActionState, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/src/components/ui/alert-dialog';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import type { ActionState } from '@/src/lib/app/actionResult';
import type { NotionMapping, NotionSchema, NotionSettingsView } from '@/src/lib/integrations/notion';
import { DateTime } from '../comments/DateTime';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { loadNotionDataSourcesAction, loadNotionSchemaAction, manageNotionAction, saveNotionMappingAction } from './actions';

type SchemaOptions = Extract<NonNullable<Awaited<ReturnType<typeof loadNotionSchemaAction>>>, { ok: true }>['data'];
const outcomes: Record<string, string> = {
    connected: 'Notion is connected.',
    denied: 'The Notion connection was canceled. You can connect again.',
    failed: 'Notion could not complete the connection. Try connecting again.',
    unavailable: 'Notion is unavailable right now. Try again later.'
};
const problems: Record<string, string> = {
    mapping_invalid: 'A mapped field changed in Notion. Load the fields and save the mapping again.',
    data_source_missing: 'The saved database is unavailable. Share it with the Notion connection or choose another database.',
    insufficient_capabilities: 'Notion needs permission to read, insert and update content. Check the connection in Notion, then load the fields again.',
    cleanup_blocked: 'Some copied content could not be removed. Restore access to its previous Notion workspace or database, then save its mapping to retry cleanup.',
    request_blocked: 'Notion blocked this connection’s requests. Check its access in Notion before turning sync on again.'
};

export function NotionSection({ projectId, settings, outcome }: { projectId: string; settings: NotionSettingsView; outcome?: string }) {
    const connected = settings.status !== 'not_connected';
    const notice = outcome && Object.hasOwn(outcomes, outcome) && (outcome !== 'connected' || connected) ? outcomes[outcome] : undefined;
    const problem = settings.statusCode && Object.hasOwn(problems, settings.statusCode) ? problems[settings.statusCode] : undefined;
    const status = !settings.configured ? 'Unavailable' : !connected ? 'Not connected' : settings.status === 'needs_reconnect'
        ? 'Reconnect needed' : settings.status === 'paused' ? 'Waiting for Notion' : !settings.dataSourceId ? 'Choose a destination' : settings.enabled ? 'Sync on' : 'Sync off';
    return <Section id="notion" title="Notion" description="Create one Notion page for each shared feedback thread. uier keeps its fields, discussion and screenshot up to date."
        actions={<Badge variant="secondary">{status}</Badge>}>
        <div className="flex flex-col gap-5">
            {notice && <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>}
            {!settings.configured ? <p className="m-0 text-sm text-muted-foreground">Notion is unavailable on this deployment. A site administrator needs to configure it.</p> : <>
                {settings.notionWorkspaceName && <p className="m-0 text-sm">Connected workspace: {settings.notionWorkspaceName}.</p>}
                {(!connected || settings.status === 'needs_reconnect') && <Button asChild className="w-fit">
                    <a href={`/app/notion/connect?project=${encodeURIComponent(projectId)}`}><ArrowUpRight data-icon="inline-start" />
                        {settings.status === 'needs_reconnect' ? 'Reconnect Notion' : 'Connect Notion'}</a>
                </Button>}
                {connected && settings.status !== 'needs_reconnect' && <>
                    {problem && <Alert><AlertTitle>Check the Notion connection</AlertTitle><AlertDescription>{problem}</AlertDescription></Alert>}
                    {settings.dataSourceId && <p className="m-0 text-sm">Destination: {settings.dataSourceName ?? 'Saved database'}.</p>}
                    <NotionDestination projectId={projectId} settings={settings} />
                </>}
            </>}
            {settings.lastSyncedAt && <p className="m-0 text-sm text-muted-foreground">Last synced <DateTime value={settings.lastSyncedAt} />.</p>}
            {settings.pausedUntil && <p className="m-0 text-sm text-muted-foreground">Notion requests resume after <DateTime value={settings.pausedUntil} />.</p>}
            {settings.needsReviewCount > 0 && <Alert><AlertTitle>Some threads need review</AlertTitle>
                <AlertDescription>{settings.needsReviewCount}{settings.needsReviewCountCapped ? '+' : ''} threads could not be confirmed in Notion. Check their existing copies before retrying. uier retains uncertain page identities to avoid duplicates.</AlertDescription>
            </Alert>}
            {settings.backfill && <p role="status" className="m-0 text-sm text-muted-foreground">Backfill: {settings.backfill.queued} of {settings.backfill.total} selected threads queued for delivery.
                {settings.backfill.done && ' Queueing is complete. Delivery continues in the background.'}</p>}
            {connected && <NotionManagement projectId={projectId} settings={settings} />}
            <p className="m-0 text-sm text-muted-foreground">Private feedback is never sent. Making shared feedback private or deleting it clears and trashes reachable Notion pages. Notion’s history, files and other retained copies follow its own settings.</p>
        </div>
    </Section>;
}

function NotionDestination({ projectId, settings }: { projectId: string; settings: NotionSettingsView }) {
    const id = useId();
    const [, startLoad] = useTransition();
    const [sources, loadSources, loadingSources] = useActionState(loadNotionDataSourcesAction, null);
    const [fields, loadFields, loadingFields] = useActionState(loadNotionSchemaAction, null);
    const [sourceId, setSourceId] = useState(settings.dataSourceId ?? '');
    const choices = sources?.ok ? sources.data : [];
    const allChoices = settings.dataSourceId && !choices.some(item => item.id === settings.dataSourceId)
        ? [{ id: settings.dataSourceId, name: settings.dataSourceName ?? 'Saved database' }, ...choices] : choices;
    const options = fields?.ok && fields.data.dataSourceId === sourceId ? fields.data : undefined;
    return <FieldGroup>
        <Field>
            <FieldLabel>Notion databases</FieldLabel>
            <FieldDescription>Load databases shared with this Notion connection. These actions only read your choices.</FieldDescription>
            <form action={loadSources}><input type="hidden" name="projectId" value={projectId} />
                <Button type="submit" variant="outline" disabled={loadingSources || loadingFields}>
                    {loadingSources ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}Load databases
                </Button>
            </form>
            <FormMessage state={sources} />
            {sources?.ok && !sources.data.length && <FieldDescription>No databases are available. Share a database with this connection in Notion, then load again.</FieldDescription>}
            {sources?.ok && sources.data.length >= 500 && <FieldDescription>Only the first 500 databases are shown.</FieldDescription>}
        </Field>
        {allChoices.length > 0 && <form onSubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget); startLoad(() => loadFields(data));
        }}>
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="dataSourceId" value={sourceId} />
            <FieldGroup>
                <Field><FieldLabel htmlFor={`${id}-source`}>Database</FieldLabel>
                    <Select value={sourceId} onValueChange={setSourceId} disabled={loadingFields}>
                        <SelectTrigger id={`${id}-source`}><SelectValue placeholder="Choose a database" /></SelectTrigger>
                        <SelectContent><SelectGroup>{allChoices.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>For a database with multiple data sources, each source appears as a separate choice.</FieldDescription>
                </Field>
                <Field><Button type="submit" className="w-fit" variant="outline" disabled={!sourceId || loadingFields || loadingSources}>
                    {loadingFields && <Spinner data-icon="inline-start" />}Load fields</Button><FormMessage state={fields} /></Field>
            </FieldGroup>
        </form>}
        {options && <NotionMappingForm key={`${options.dataSourceId}:${JSON.stringify(options.schema)}`} projectId={projectId} settings={settings} options={options} />}
    </FieldGroup>;
}

type MappingKey = Exclude<keyof NotionMapping, 'status'>;
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
    return result;
}
function NotionMappingForm({ projectId, settings, options }: { projectId: string; settings: NotionSettingsView; options: SchemaOptions }) {
    const id = useId(); const form = useRef<HTMLFormElement>(null); const confirmed = useRef(false);
    const [state, save, pending] = useActionState(saveNotionMappingAction, null);
    const [mapping, setMapping] = useState(() => initialMapping(options, settings));
    const [confirming, setConfirming] = useState(false);
    const chosen = [...mappedFields.map(field => mapping[field.key]).filter(Boolean), mapping.status?.property].filter(Boolean);
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
                <FieldSet disabled={pending}><FieldLegend>Map Notion fields</FieldLegend>
                    <FieldDescription>Choose existing fields of the matching type. The uier id uses a separate rich text field to prevent duplicate pages. Optional fields can stay unmapped.</FieldDescription>
                    <FieldGroup>{mappedFields.map(field => <PropertyChoice key={field.key} id={`${id}-${field.key}`} label={field.label} schema={options.schema}
                        types={[field.type]} value={mapping[field.key] ?? ''} required={field.required} disabled={pending} invalid={duplicates.has(mapping[field.key] ?? '')}
                        onChange={value => setMapping(current => ({ ...current, [field.key]: value === 'none' ? '' : value }))} />)}
                        <PropertyChoice id={`${id}-status`} label="Status" schema={options.schema} types={['status', 'select']} value={mapping.status?.property ?? ''}
                            disabled={pending} invalid={duplicates.has(mapping.status?.property ?? '')} onChange={chooseStatus} />
                        {mapping.status && <>
                            {(['open', 'done'] as const).map(value => <Field key={value} data-invalid={mapping.status!.open === mapping.status!.done}>
                                <FieldLabel htmlFor={`${id}-${value}`}>{value === 'open' ? 'Status for open feedback' : 'Status for done feedback'}</FieldLabel>
                                {statusField && statusField.type === 'status' ? <Select value={mapping.status![value]} disabled={pending}
                                    onValueChange={name => setMapping(current => ({ ...current, status: { ...current.status!, [value]: name } }))}>
                                    <SelectTrigger id={`${id}-${value}`} aria-invalid={mapping.status!.open === mapping.status!.done}><SelectValue placeholder="Choose a status" /></SelectTrigger>
                                    <SelectContent><SelectGroup>{statusField.options?.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectGroup></SelectContent>
                                </Select> : <Input id={`${id}-${value}`} value={mapping.status![value]} maxLength={100} disabled={pending}
                                    aria-invalid={mapping.status!.open === mapping.status!.done} onChange={event => setMapping(current => ({ ...current, status: { ...current.status!, [value]: event.target.value } }))} />}
                            </Field>)}
                            <FieldDescription>Choose different names for open and done feedback. A select field can create these choices; commas are not supported.</FieldDescription>
                        </>}
                    </FieldGroup>
                </FieldSet>
                {(!mapping.title || !mapping.uierId) && <Alert><AlertTitle>Required fields are missing</AlertTitle><AlertDescription>Choose a title field and a rich text field for the uier id. Add missing fields in Notion, then load the fields again.</AlertDescription></Alert>}
                {duplicates.size > 0 && <Alert><AlertTitle>Choose separate fields</AlertTitle><AlertDescription>A Notion field can only be mapped once.</AlertDescription></Alert>}
                <FieldDescription>Saving turns sync on for shared feedback, including screenshots. Existing Notion pages stay in their previous database when the destination changes.</FieldDescription>
                <Field><Button type="submit" className="w-fit" disabled={pending || invalid}>{pending && <Spinner data-icon="inline-start" />}Save Notion mapping</Button><FormMessage state={state} /></Field>
            </FieldGroup>
        </form>
        <AlertDialog open={confirming} onOpenChange={setConfirming}><AlertDialogContent><AlertDialogHeader>
            <AlertDialogTitle>Switch Notion database?</AlertDialogTitle><AlertDialogDescription>Future changes create pages in {options.dataSourceName}. Existing pages stay in the previous database. Backfill can queue existing shared feedback for the new destination.</AlertDialogDescription>
        </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>Keep current database</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={event => { event.preventDefault(); confirmed.current = true; setConfirming(false); form.current?.requestSubmit(); confirmed.current = false; }}>Switch database</AlertDialogAction>
        </AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>;
}
function PropertyChoice({ id, label, schema, types, value, onChange, required = false, disabled, invalid }: {
    id: string; label: string; schema: NotionSchema; types: string[]; value: string; onChange: (value: string) => void; required?: boolean; disabled: boolean; invalid?: boolean;
}) {
    const choices = Object.entries(schema).filter(([, field]) => types.includes(field.type));
    return <Field data-disabled={disabled} data-invalid={invalid}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Select value={value || 'none'} onValueChange={onChange} disabled={disabled || !choices.length}>
            <SelectTrigger id={id} aria-invalid={invalid}><SelectValue placeholder="Choose a field" /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="none">{required ? 'Choose a field' : 'Not mapped'}</SelectItem>
                {choices.map(([key, field]) => <SelectItem key={key} value={key}>{field.name}</SelectItem>)}
            </SelectGroup></SelectContent>
        </Select>
        {!choices.length && <FieldDescription>No {types.join(' or ')} fields are available.</FieldDescription>}
    </Field>;
}

function NotionManagement({ projectId, settings }: { projectId: string; settings: NotionSettingsView }) {
    const router = useRouter(); const [state, setState] = useState<ActionState<{ message: string }>>(null);
    const [pending, startTransition] = useTransition(); const [confirming, setConfirming] = useState(false);
    const change = (operation: 'enable' | 'disable' | 'disconnect' | 'backfill') => startTransition(async () => {
        const form = new FormData(); form.set('projectId', projectId); form.set('operation', operation);
        const result = await manageNotionAction(null, form); setState(result);
        if (result?.ok) { setConfirming(false); router.refresh(); }
    });
    const canSync = settings.configured && Boolean(settings.dataSourceId) && settings.status === 'connected';
    return <div className="flex flex-col gap-3"><div className="flex flex-wrap gap-2">
        {settings.configured && settings.status !== 'needs_reconnect' && <Button asChild variant="outline"><a href={`/app/notion/connect?project=${encodeURIComponent(projectId)}`}>Reconnect Notion</a></Button>}
        {(settings.enabled || canSync) && <Button type="button" variant="outline" disabled={pending} onClick={() => change(settings.enabled ? 'disable' : 'enable')}>
            {pending && <Spinner data-icon="inline-start" />}{settings.enabled ? 'Turn sync off' : 'Turn sync on'}</Button>}
        {canSync && settings.enabled && <Button type="button" variant="outline" disabled={pending || Boolean(settings.backfill && !settings.backfill.done)} onClick={() => change('backfill')}>Backfill existing feedback</Button>}
        <AlertDialog open={confirming} onOpenChange={setConfirming}><AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={pending}>Disconnect Notion</Button></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Disconnect Notion from this project?</AlertDialogTitle>
                <AlertDialogDescription>Stops future sync from this project. Existing pages and files remain in Notion. Other projects keep their connections.</AlertDialogDescription>
            </AlertDialogHeader><FormMessage state={state && !state.ok ? state : null} /><AlertDialogFooter><AlertDialogCancel disabled={pending}>Keep connected</AlertDialogCancel>
                <AlertDialogAction variant="outline" disabled={pending} onClick={event => { event.preventDefault(); change('disconnect'); }}>{pending && <Spinner data-icon="inline-start" />}Disconnect Notion</AlertDialogAction>
            </AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
    </div>
        {canSync && <p className="m-0 text-sm text-muted-foreground">Backfill selects up to 1,000 existing shared threads for this Notion destination. New feedback syncs automatically while sync is on.</p>}
        <FormMessage state={state?.ok ? { ...state, message: state.data.message } : state} />
    </div>;
}
