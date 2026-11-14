'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button, buttonVariants } from '../../../ui/button';
import { Checkbox } from '../../../ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../../ui/field';
import { Input } from '../../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select';
import { Section } from '../../PageHeader';
import { SaveFooter, useSettingsDraft } from '../../SettingsSave';
import { useAppI18n } from '../../../../lib/i18n/client';
import { KnownPages } from '../../../../knownPages';
import type { NotionSchema } from '../../../../lib/integrations/notion/model';
import type { NotionProjectsView } from '../../../../lib/integrations/notion/projects/model';
import { statusPropertyTypes, urlPropertyTypes } from '../../../../lib/integrations/notion/projects/model';
import { loadProjectDatabasesAction, loadProjectFieldsAction, saveProjectMappingAction, stopProjectSyncAction } from './actions';

function Choice({ id, label, value, onChange, options, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void;
    options: { value: string; label: string }[]; disabled: boolean }) {
    return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select value={value} items={options} onValueChange={value => onChange(value ?? '')} disabled={disabled}>
        <SelectTrigger id={id} className="w-full max-w-md"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select></Field>;
}
export function NotionProjectsForm({ view, outcome }: { view: NotionProjectsView; outcome?: string }) {
    const { t, language } = useAppI18n(); const router = useRouter(); const id = useId();
    const [result, formAction, saving] = useActionState(saveProjectMappingAction, null);
    const [loading, start] = useTransition(); const busy = loading || saving;
    const { draft, dirty, update, discard } = useSettingsDraft({ dataSourceId: view.config.dataSourceId ?? '',
        urls: view.config.mapping?.urls ?? [] as string[], name: view.config.mapping?.name ?? '', status: view.config.mapping?.status ?? '',
        done: view.config.mapping?.done.join('\n') ?? '' }, result);
    const [sources, setSources] = useState<{ id: string; name: string }[] | null>(null);
    const [fields, setFields] = useState<{ dataSourceId: string; schema: NotionSchema } | null>(null);
    const schema = fields?.dataSourceId === draft.dataSourceId ? fields.schema : draft.dataSourceId === view.config.dataSourceId ? view.config.schema : undefined;
    const entries = Object.entries(schema ?? {});
    const options = (types: string[], optional = false) => [{ value: '', label: optional ? t('Not mapped') : t('Choose a field') },
        ...entries.filter(([, field]) => types.includes(field.type)).map(([value, field]) => ({ value, label: field.name }))];
    const statusType = schema?.[draft.status]?.type;
    const done = draft.done.split('\n').map(value => value.trim()).filter(Boolean);
    const ids = [...draft.urls, draft.status, ...(draft.name ? [draft.name] : [])];
    const unique = new Set(ids).size === ids.length;
    const canSave = Boolean(schema && draft.dataSourceId && draft.urls.length && draft.status && done.length && unique);
    const loadSources = () => start(async () => {
        const response = await loadProjectDatabasesAction();
        if (!response?.ok) { toast.error(t(response?.error ?? 'Something went wrong. Try again.')); return; }
        setSources(response.data);
    });
    const loadFields = () => start(async () => {
        const response = await loadProjectFieldsAction(draft.dataSourceId);
        if (!response?.ok) { toast.error(t(response?.error ?? 'Something went wrong. Try again.')); return; }
        setFields(response.data);
        // Leave an already saved mapping as-is; otherwise offer sensible, editable defaults.
        if (draft.dataSourceId !== view.config.dataSourceId || !view.config.mapping) {
            const fields = Object.entries(response.data.schema);
            const status = fields.find(([, field]) => field.type === 'status') ?? fields.find(([, field]) => statusPropertyTypes.includes(field.type));
            update(current => ({ ...current, urls: fields.filter(([, field]) => field.type === 'url').map(([key]) => key),
                name: fields.find(([, field]) => field.type === 'title')?.[0] ?? '', status: status?.[0] ?? '',
                done: status?.[1].type === 'checkbox' ? 'true' : status?.[1].options?.find(value => value.toLowerCase() === 'done') ?? '' }));
        }
    });
    const stop = (action: 'pause' | 'disconnect') => start(async () => {
        const response = await stopProjectSyncAction(action);
        if (!response?.ok) toast.error(t(response?.error ?? 'Something went wrong. Try again.'));
        else router.refresh();
    });
    const connected = view.connected && view.status !== 'needs_reconnect';
    return <Section id="notion-projects" title={t('Projects from Notion')}
        description={t('Create one project per database row. Notion keeps its name, addresses and status up to date.')}>
        <div className="flex flex-col gap-5">
            <p className="m-0 text-sm text-muted-foreground">{t('Projects start with invited access. Sync never deletes projects or feedback. Switching a project to manual stops all future updates from Notion.')}</p>
            {outcome === 'denied' && <p role="status" className="m-0 text-sm">{t('The Notion connection was canceled.')}</p>}
            {['failed', 'unavailable'].includes(outcome ?? '') && <p role="alert" className="m-0 text-sm text-destructive">{t('Could not update Notion projects. Check the connection and selected fields.')}</p>}
            {!view.configured && <p className="m-0 text-sm">{t('Notion is unavailable on this deployment. A site administrator needs to configure it.')}</p>}
            <p className="m-0 text-sm" role="status">{!view.connected ? t('Not connected') : view.status === 'needs_reconnect' ? t('Reconnect Notion') : view.enabled ? t('Sync on') : t('Sync off')}
                {view.config.notionWorkspaceName && <> · {view.config.notionWorkspaceName}</>}</p>
            {view.statusCode && view.statusCode !== 'disconnected' && <p role="alert" className="m-0 text-sm">{t('Could not update Notion projects. Check the connection and selected fields.')}</p>}
            {view.lastSyncedAt && <p className="m-0 text-sm text-muted-foreground">{t('Last complete sync')}: <time dateTime={view.lastSyncedAt}>{new Date(view.lastSyncedAt).toLocaleString(language)}</time></p>}
            {Boolean(view.skippedRows) && <p className="m-0 text-sm text-muted-foreground">{t('Some rows were left unchanged. Check their addresses and mapped fields. Manual, deleted and transferred projects are also left alone.')}</p>}
            <div className="flex flex-wrap gap-2">
                {view.configured && <a href={KnownPages.AppNotionProjectsConnect} className={buttonVariants({ variant: 'outline' })}>{view.connected ? t('Reconnect Notion') : t('Connect Notion')}</a>}
                {view.connected && <Button variant="outline" disabled={busy} onClick={() => stop('disconnect')}>{t('Disconnect Notion')}</Button>}
                {view.enabled && <Button variant="outline" disabled={busy} onClick={() => stop('pause')}>{t('Pause project sync')}</Button>}
            </div>
            {connected && view.configured && <>
                <Button variant="outline" disabled={busy} onClick={loadSources} className="self-start">{t('Load databases')}</Button>
                {sources?.length === 0 && <p role="status" className="m-0 text-sm">{t('No databases are available. Share a database with this connection in Notion, then load again.')}</p>}
                <Choice id={`${id}-database`} label={t('Database')} value={draft.dataSourceId} disabled={busy} onChange={dataSourceId => update(current => ({ ...current, dataSourceId, urls: [], name: '', status: '', done: '' }))}
                    options={[{ value: '', label: t('Choose a database') }, ...(sources ?? (view.config.dataSourceId ? [{ id: view.config.dataSourceId, name: view.config.dataSourceName ?? '' }] : [])).map(source => ({ value: source.id, label: source.name }))]} />
                <Button variant="outline" disabled={busy || !draft.dataSourceId} onClick={loadFields} className="self-start">{t('Load fields')}</Button>
                {schema && <form id={id} action={formAction} onResetCapture={event => event.preventDefault()}>
                    <input type="hidden" name="dataSourceId" value={draft.dataSourceId} />
                    <input type="hidden" name="mapping" value={JSON.stringify({ urls: draft.urls, name: draft.name || undefined, status: draft.status, done })} />
                    <FieldGroup>
                        <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                            <legend className="mb-2 text-sm font-medium">{t('Address columns')}</legend>
                            <FieldDescription>{t('Choose URL, text or multi-select columns. Separate several addresses in text with spaces, commas or new lines.')}</FieldDescription>
                            {entries.filter(([, field]) => urlPropertyTypes.includes(field.type)).map(([key, field]) => <Field key={key} orientation="horizontal">
                                <Checkbox id={`${id}-url-${key}`} checked={draft.urls.includes(key)} onCheckedChange={checked => update(current => ({ ...current, urls: checked ? [...current.urls, key] : current.urls.filter(value => value !== key) }))} />
                                <FieldLabel htmlFor={`${id}-url-${key}`}>{field.name}</FieldLabel>
                            </Field>)}
                        </fieldset>
                        <Choice id={`${id}-name`} label={t('Project name column (optional)')} value={draft.name} disabled={busy} options={options(['title', 'rich_text'], true)} onChange={name => update(current => ({ ...current, name }))} />
                        <Choice id={`${id}-status`} label={t('Status column')} value={draft.status} disabled={busy} options={options(statusPropertyTypes)} onChange={status => update(current => ({ ...current, status, done: schema[status]?.type === 'checkbox' ? 'true' : '' }))} />
                        {statusType === 'checkbox' ? <p className="m-0 text-sm">{t('Checked rows mark the project done.')}</p> : schema[draft.status]?.options ? <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                            <legend className="mb-2 text-sm font-medium">{t('Done values')}</legend>
                            {schema[draft.status]!.options!.map(value => <Field key={value} orientation="horizontal"><Checkbox id={`${id}-done-${value}`} checked={done.includes(value)} onCheckedChange={checked => update(current => ({ ...current, done: (checked ? [...done, value] : done.filter(item => item !== value)).join('\n') }))} /><FieldLabel htmlFor={`${id}-done-${value}`}>{value}</FieldLabel></Field>)}
                        </fieldset> : <Field><FieldLabel htmlFor={`${id}-done`}>{t('Done values')}</FieldLabel><Input id={`${id}-done`} value={draft.done} disabled={busy} onChange={event => update(current => ({ ...current, done: event.target.value }))} /><FieldDescription>{t('Match the status text exactly.')}</FieldDescription></Field>}
                    </FieldGroup>
                    {!unique && <p role="alert" className="mt-4 text-sm">{t('A Notion field can only be mapped once.')}</p>}
                    {!draft.urls.length && <p role="status" className="mt-4 text-sm">{t('Required fields are missing')}</p>}
                    <p className="my-4 text-sm text-muted-foreground">{t('Save to enable sync. Rows without addresses are skipped. Other statuses keep the project active.')}</p>
                    <div className="flex flex-wrap items-center gap-2"><SaveFooter formId={id} state={result} pending={busy} dirty={dirty || !view.enabled} canSave={canSave} onDiscard={discard} /></div>
                </form>}
            </>}
        </div>
    </Section>;
}
