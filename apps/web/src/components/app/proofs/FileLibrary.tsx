'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { FileIcon, FolderIcon, PlusIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { useAppI18n } from '@/src/lib/i18n/client';
import {
    MAX_PROOF_UPLOAD_BYTES, proofUploadTypes, proofApiPath, proofCollectionPath, proofViewerPath,
    type ProofAsset, type ProofAssetDetail, type ProofCollection, type ProofFormat, type ProofLibrary, type ProofUploadGrant, type ProofVersion
} from '@/src/lib/proofs/model';
import { proofErrorMessage, proofFetch, proofWrite, ProofRequestError } from './client';
import { ProofSelect } from './ProofSelect';
import { ProofShares } from './ProofShares';
import { ProofPrototypeDirectory } from './ProofPrototypeDirectory';
import { FigmaImport, ProofEmailAddress, ProofFormatSettings, type ProofUploadSettings } from './ProofSources';

const PrototypeDirectory = dynamic(() => import('./ProofPrototypeDirectory').then(module => module.ProofPrototypeDirectory), { ssr: false });

type Editor = { kind: 'new-file' | 'figma' | 'formats' } | { kind: 'file'; asset: ProofAsset } | { kind: 'collection'; collection?: ProofCollection };
type LibraryProps = { projectId: string; guestSharing: boolean; reviewSettingsHref?: string; siteSettingsHref?: string };

const byPosition = (a: { position: number; name: string }, b: { position: number; name: string }) =>
    a.position - b.position || a.name.localeCompare(b.name);

const versionLabels = { pending: 'Waiting for upload', processing: 'Processing', failed: 'Failed', published: 'Published' } as const;

function fileContentType(file: File) {
    if (file.type === 'application/x-zip-compressed') return 'application/zip';
    if (file.type && file.type !== 'application/octet-stream') return file.type;
    const types: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
        svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime',
        webm: 'video/webm', eml: 'message/rfc822', html: 'text/html', htm: 'text/html', zip: 'application/zip'
    };
    return types[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? file.type;
}

export function FileLibrary(props: LibraryProps) {
    const { projectId, siteSettingsHref } = props;
    const { t } = useAppI18n();
    const api = proofApiPath(projectId);
    const [settings, setSettings] = useState<ProofUploadSettings>({ formats: ['image'], htmlAvailable: false, canEdit: false });
    const formats = settings.formats;
    const [library, setLibrary] = useState<ProofLibrary>();
    const [error, setError] = useState('');
    const [editor, setEditor] = useState<Editor>();
    const [attempt, setAttempt] = useState(0);
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(() => setAttempt(value => value + 1), []);
    useEffect(() => {
        const controller = new AbortController();
        proofFetch<ProofLibrary>(api, { signal: controller.signal }).then(
            result => {
                setLibrary(result);
                setError('');
                if (result.permissions.manage) {
                    void proofFetch<ProofUploadSettings>(`${api}/settings`, { signal: controller.signal }).then(
                        result => { if (!controller.signal.aborted) setSettings(result); },
                        () => {}
                    );
                }
            },
            error => { if (!controller.signal.aborted) setError(proofErrorMessage(error)); }
        );
        return () => controller.abort();
    }, [api, attempt]);

    const row = (asset: ProofAsset) => (
        <li key={asset.id} className="flex items-center gap-3 p-3 sm:px-4">
            <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
                {asset.currentVersionId
                    ? <Link href={proofViewerPath(projectId, asset.id)} prefetch={false} className="break-words font-medium text-foreground hover:underline">{asset.name}</Link>
                    : <span className="break-words font-medium">{asset.name}</span>}
                {!asset.currentVersionId && <p className="m-0 text-xs text-muted-foreground">{t('No published version')}</p>}
            </div>
            {library?.permissions.manage && <Button variant="outline" size="sm" onClick={() => setEditor({ kind: 'file', asset })}
                aria-label={t('Manage {name}', { name: asset.name })}>{t('Manage')}</Button>}
        </li>
    );

    return (
        <section aria-labelledby="proof-files" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="proof-files" className="m-0 text-xl font-semibold">{t('Files')}</h2>
                <div className="flex flex-wrap gap-2">
                    {siteSettingsHref && <Link href={siteSettingsHref} className={buttonVariants({ variant: 'ghost' })}>{t('Add a site address')}</Link>}
                    {library?.permissions.manage && <>
                        {settings.canEdit && <Button variant="ghost" onClick={() => setEditor({ kind: 'formats' })}>{t('File formats')}</Button>}
                        <Button variant="outline" onClick={() => setEditor({ kind: 'collection' })}>{t('New collection')}</Button>
                        {formats.includes('figma') && <Button variant="outline" onClick={() => setEditor({ kind: 'figma' })}>{t('Import from Figma')}</Button>}
                        {formats.some(format => proofUploadTypes[format].length > 0) &&
                            <Button onClick={() => setEditor({ kind: 'new-file' })}><PlusIcon data-icon="inline-start" />{t('Upload file')}</Button>}
                    </>}
                </div>
            </div>
            {error && <div role="alert" className="flex flex-wrap items-center gap-3">
                <p className="m-0 text-sm text-destructive">{t(error)}</p>
                <Button variant="outline" onClick={refresh}>{t('Retry')}</Button>
            </div>}
            {!library && !error && <p role="status" className="text-sm text-muted-foreground">{t('Loading files')}…</p>}
            {library && <>
                {library.assets.length === 0 && library.collections.length === 0 &&
                    <p className="m-0 rounded-xl border p-7 text-sm text-muted-foreground">{t('Upload a file to start a review.')}</p>}
                {library.assets.some(asset => !asset.collectionId) && <ul className="m-0 list-none divide-y rounded-xl border p-0">
                    {library.assets.filter(asset => !asset.collectionId).sort(byPosition).map(row)}
                </ul>}
                {[...library.collections].sort(byPosition).map(collection => (
                    <section key={collection.id} aria-label={collection.name} className="min-w-0 overflow-hidden rounded-xl border">
                        <div className="flex items-center gap-3 bg-muted/40 p-3 sm:px-4">
                            <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <h3 className="m-0 min-w-0 flex-1 break-words text-sm font-medium">
                                <Link href={proofCollectionPath(projectId, collection.id)} prefetch={false} className="hover:underline">{collection.name}</Link>
                            </h3>
                            {library.permissions.manage && <Button size="sm" variant="outline" aria-label={t('Manage {name}', { name: collection.name })}
                                onClick={() => setEditor({ kind: 'collection', collection })}>{t('Manage')}</Button>}
                        </div>
                        {library.assets.some(asset => asset.collectionId === collection.id)
                            ? <ul className="m-0 list-none divide-y border-t p-0">{library.assets.filter(asset => asset.collectionId === collection.id).sort(byPosition).map(row)}</ul>
                            : <p className="m-0 border-t p-3 text-sm text-muted-foreground">{t('This collection is empty.')}</p>}
                    </section>
                ))}
            </>}
            <Dialog open={Boolean(editor)} onOpenChange={open => { if (!open && !busy) setEditor(undefined); }}>
                {editor && (
                    <DialogContent showCloseButton={!busy} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
                        {editor.kind === 'collection' && <CollectionEditor {...props} api={api} collection={editor.collection} refresh={refresh}
                            onBusy={setBusy} close={() => setEditor(undefined)} />}
                        {(editor.kind === 'file' || editor.kind === 'new-file') &&
                            <AssetEditor {...props} api={api} asset={editor.kind === 'file' ? editor.asset : undefined} collections={library?.collections ?? []}
                                formats={formats} refresh={refresh} onBusy={setBusy} close={() => setEditor(undefined)} />}
                        {editor.kind === 'formats' && <>
                            <DialogHeader>
                                <DialogTitle>{t('File formats')}</DialogTitle>
                                <DialogDescription>{t('Choose which formats members can upload.')}</DialogDescription>
                            </DialogHeader>
                            <ProofFormatSettings api={api} settings={settings} onBusy={setBusy} onSave={formats => {
                                setSettings(current => ({ ...current, formats }));
                                setEditor(undefined);
                            }} />
                        </>}
                        {editor.kind === 'figma' && <>
                            <DialogHeader>
                                <DialogTitle>{t('Import from Figma')}</DialogTitle>
                                <DialogDescription>{t('Choose the frames to share in a file review.')}</DialogDescription>
                            </DialogHeader>
                            <FigmaImport api={api} onBusy={setBusy} onAsset={refresh} onVersion={() => { refresh(); setEditor(undefined); }} />
                        </>}
                    </DialogContent>
                )}
            </Dialog>
        </section>
    );
}

type EditorProps = LibraryProps & { api: string; refresh: () => void; onBusy: (value: boolean) => void; close: () => void };

function useProofMutation(onBusy: (value: boolean) => void) {
    const [progress, setProgress] = useState('');
    const [error, setError] = useState('');
    const active = useRef(false);
    async function run(message: string, task: () => Promise<void>) {
        if (active.current) return;
        active.current = true;
        setError('');
        setProgress(message);
        onBusy(true);
        try {
            await task();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'The request could not be completed.');
        } finally {
            active.current = false;
            setProgress('');
            onBusy(false);
        }
    }
    return { progress, setProgress, error, setError, run };
}

function MutationStatus({ progress, error }: { progress?: string; error?: string }) {
    const { t } = useAppI18n();
    return <>
        {progress && <p role="status" className="m-0 text-sm text-muted-foreground">{t(progress)}</p>}
        {error && <p role="alert" className="m-0 text-sm text-destructive">{t(error)}</p>}
    </>;
}

function CollectionEditor({ api, collection, guestSharing, reviewSettingsHref, refresh, onBusy, close }: EditorProps & { collection?: ProofCollection }) {
    const { t } = useAppI18n();
    const id = useId();
    const mutation = useProofMutation(onBusy);
    const [confirm, setConfirm] = useState(false);
    const route = collection ? `${api}/collections/${encodeURIComponent(collection.id)}` : `${api}/collections`;
    const save = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void mutation.run('Saving…', async () => {
            await proofWrite(route, collection ? 'PATCH' : 'POST', {
                name: String(fields.get('name')), position: Number(fields.get('position'))
            });
            refresh();
            close();
        });
    };
    return <>
        <DialogHeader>
            <DialogTitle>{collection ? collection.name : t('New collection')}</DialogTitle>
            <DialogDescription>{t('Group files in a single review link.')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
            <Field>
                <FieldLabel htmlFor={`${id}-name`}>{t('Collection name')}</FieldLabel>
                <Input id={`${id}-name`} name="name" defaultValue={collection?.name} maxLength={120} required />
            </Field>
            <PositionField id={id} position={collection?.position} />
            <Button type="submit" disabled={Boolean(mutation.progress)} className="justify-self-start">{t(collection ? 'Save' : 'Create collection')}</Button>
        </form>
        {collection && <>
            <ProofShares api={api} scope={{ kind: 'collection', id: collection.id }} enabled={guestSharing} settingsHref={reviewSettingsHref} />
            <DialogFooter>
                {confirm && <Button variant="outline" onClick={() => setConfirm(false)}>{t('Cancel')}</Button>}
                <Button variant={confirm ? 'destructive' : 'outline'} disabled={Boolean(mutation.progress)} onClick={() => {
                    if (!confirm) return setConfirm(true);
                    void mutation.run('Deleting…', async () => { await proofWrite(route, 'DELETE'); refresh(); close(); });
                }}>{t(confirm ? 'Confirm deletion' : 'Delete empty collection')}</Button>
            </DialogFooter>
        </>}
        <MutationStatus {...mutation} />
    </>;
}

function PositionField({ id, position }: { id: string; position?: number }) {
    const { t } = useAppI18n();
    return <Field>
        <FieldLabel htmlFor={`${id}-position`}>{t('Position')}</FieldLabel>
        <Input id={`${id}-position`} name="position" type="number" min="0" max="1000000" step="1" defaultValue={position ?? 0} required />
        <FieldDescription>{t('Lower numbers appear first.')}</FieldDescription>
    </Field>;
}

function AssetEditor({ api, projectId, asset: initialAsset, collections, formats, guestSharing, reviewSettingsHref, refresh, onBusy, close }: EditorProps & {
    asset?: ProofAsset; collections: ProofCollection[]; formats: ProofFormat[];
}) {
    const { t, language } = useAppI18n();
    const id = useId();
    const mutation = useProofMutation(onBusy);
    const [asset, setAsset] = useState(initialAsset);
    const [details, setDetails] = useState<ProofAssetDetail>();
    const [detailError, setDetailError] = useState('');
    const [name, setName] = useState(initialAsset?.name ?? '');
    const [collectionId, setCollectionId] = useState(initialAsset?.collectionId ?? 'none');
    const [file, setFile] = useState<File>();
    const [confirm, setConfirm] = useState(false);
    const [figmaOpen, setFigmaOpen] = useState(false);
    const [reload, setReload] = useState(0);
    const receipt = useRef<{ file: File; requestId: string; expectedVersionId: string | null } | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const route = asset ? `${api}/assets/${encodeURIComponent(asset.id)}` : null;
    useEffect(() => {
        if (!route) return;
        const controller = new AbortController();
        proofFetch<ProofAssetDetail>(route, { signal: controller.signal }).then(
            result => { setDetails(result); setAsset(result.asset); setDetailError(''); },
            error => { if (!controller.signal.aborted) setDetailError(proofErrorMessage(error)); }
        );
        return () => controller.abort();
    }, [route, reload]);

    const accepts = formats.flatMap(format => proofUploadTypes[format]);
    const position = (form: FormData) => Number(form.get('position'));
    async function create(fields: FormData) {
        const created = await proofWrite<{ asset: ProofAsset }>(`${api}/assets`, 'POST', {
            name: name.trim(), ...(collectionId === 'none' ? {} : { collectionId }), position: position(fields)
        });
        setAsset(created.asset);
        refresh();
        return created.asset;
    }

    async function finalize(assetId: string, versionId: string) {
        const { version } = await proofWrite<{ version: ProofVersion }>(
            `${api}/assets/${encodeURIComponent(assetId)}/uploads/${encodeURIComponent(versionId)}/finalize`, 'POST'
        );
        setReload(value => value + 1);
        refresh();
        if (version.status === 'failed') throw new Error(version.failure || 'The file could not be processed.');
        return version;
    }

    function selectFile(selected?: File) {
        setFile(selected);
        if (!asset && !name && selected) setName(selected.name.replace(/\.[^.]+$/, '').slice(0, 120));
    }

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        if (!file) return;
        const contentType = fileContentType(file);
        if (!accepts.includes(contentType) || file.size < 1 || file.size > MAX_PROOF_UPLOAD_BYTES) {
            mutation.setError('Choose a supported file within the upload limit.');
            return;
        }
        void mutation.run('Preparing upload…', async () => {
            const target = asset ?? await create(fields);
            const attempt = receipt.current?.file === file ? receipt.current : {
                file, requestId: crypto.randomUUID(), expectedVersionId: target.currentVersionId
            };
            receipt.current = attempt;
            const grant = await proofWrite<ProofUploadGrant>(`${api}/assets/${encodeURIComponent(target.id)}/uploads`, 'POST', {
                requestId: attempt.requestId, expectedVersionId: attempt.expectedVersionId, filename: file.name, contentType, size: file.size
            });
            if (grant.uploadUrl) {
                mutation.setProgress('Uploading file…');
                const upload = await fetch(grant.uploadUrl, { method: 'PUT', headers: grant.headers, body: file, credentials: 'omit' });
                if (!upload.ok && upload.status !== 409 && upload.status !== 412) throw new Error('Upload failed. Select the file and try again.');
            }
            mutation.setProgress('Processing file…');
            let version: ProofVersion;
            try {
                version = await finalize(target.id, grant.version.id);
            } catch (error) {
                if (error instanceof ProofRequestError && [409, 422].includes(error.status)) {
                    receipt.current = null;
                    setReload(value => value + 1);
                    refresh();
                }
                throw error;
            }
            if (version.status === 'published') setAsset({ ...target, currentVersionId: version.id });
            receipt.current = null;
            if (fileInput.current) fileInput.current.value = '';
            setFile(undefined);
        });
    }

    return <>
        <DialogHeader>
            <DialogTitle>{asset?.name ?? t('Upload file')}</DialogTitle>
            <DialogDescription>{t(asset ? 'Manage versions and sharing for this file.' : 'Upload a file to start a review.')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
            {!asset && <>
                <Field>
                    <FieldLabel htmlFor={`${id}-name`}>{t('File name')}</FieldLabel>
                    <Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} required maxLength={120} />
                </Field>
                {collections.length > 0 && <CollectionField {...{ id, collectionId, collections, setCollectionId }} />}
                <input name="position" type="hidden" value="0" />
            </>}
            <Field>
                <FieldLabel htmlFor={`${id}-file`}>{t(asset ? 'New version file' : 'Choose file')}</FieldLabel>
                <Input ref={fileInput} id={`${id}-file`} type="file" accept={accepts.join(',')}
                    disabled={Boolean(mutation.progress)} onChange={event => selectFile(event.target.files?.[0])} />
                <FieldDescription>{t('Up to {size} MB', { size: new Intl.NumberFormat(language).format(MAX_PROOF_UPLOAD_BYTES / 1024 ** 2) })}</FieldDescription>
            </Field>
            {formats.includes('html') && <ProofPrototypeDirectory disabled={Boolean(mutation.progress)} onChange={selected => {
                if (fileInput.current) fileInput.current.value = '';
                setFile(selected);
                if (!asset && !name) setName(selected.name.replace(/\.zip$/, '').slice(0, 120));
            }} />}
            {file && !fileInput.current?.files?.length && <p role="status" className="m-0 text-sm">{file.name}</p>}
            {formats.includes('html') && <PrototypeDirectory disabled={Boolean(mutation.progress)} onChange={selected => {
                if (fileInput.current) fileInput.current.value = '';
                selectFile(selected);
            }} />}
            {file && <p className="m-0 break-words text-sm text-muted-foreground">{file.name}</p>}
            <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={!file || Boolean(mutation.progress)}>{t(asset ? 'Upload version' : 'Upload file')}</Button>
                {!asset && formats.includes('email') && <Button type="button" variant="outline" disabled={Boolean(mutation.progress)} onClick={event => {
                    const form = event.currentTarget.form;
                    if (!form?.reportValidity()) return;
                    void mutation.run('Saving…', async () => { await create(new FormData(form)); });
                }}>{t('Create file for test email')}</Button>}
            </div>
        </form>
        <MutationStatus {...mutation} />
        {asset && route && <>
            {formats.includes('figma') && (!asset.currentVersionId || details?.version?.manifest?.format === 'figma') && <div className="grid gap-3">
                <Button variant="outline" aria-expanded={figmaOpen} className="justify-self-start" onClick={() => setFigmaOpen(value => !value)}>
                    {t(details?.version?.manifest?.format === 'figma' ? 'Resync from Figma' : 'Import from Figma')}
                </Button>
                {figmaOpen && <FigmaImport key={asset.id + (asset.currentVersionId ?? '')} api={api} asset={asset} version={details?.version}
                    onAsset={setAsset} onBusy={onBusy} onVersion={version => {
                        if (version.status === 'published') setAsset({ ...asset, currentVersionId: version.id });
                        setReload(value => value + 1);
                        setFigmaOpen(false);
                        refresh();
                    }} />}
            </div>}
            {formats.includes('email') && (!asset.currentVersionId || details?.version?.manifest?.format === 'email') && <ProofEmailAddress route={route} onBusy={onBusy} />}
            <section aria-labelledby={`${id}-versions`} className="grid gap-2">
                <h3 id={`${id}-versions`} className="m-0 font-medium">{t('Versions')}</h3>
                {!details && !detailError && <p role="status" className="m-0 text-muted-foreground">{t('Loading versions…')}</p>}
                {detailError && <div role="alert"><p className="m-0 text-destructive">{t(detailError)}</p>
                    <Button variant="outline" onClick={() => setReload(value => value + 1)}>{t('Retry')}</Button></div>}
                {details && details.versions.length === 0 && <p className="m-0 text-muted-foreground">{t('No versions yet')}</p>}
                {details && details.versions.length > 0 && <ul className="m-0 list-none divide-y rounded-lg border p-0">
                    {details.versions.map(version => (
                        <li key={version.id} className="flex items-center justify-between gap-2 p-3">
                            <div className="min-w-0 break-words">
                                {version.status === 'published'
                                    ? <Link href={proofViewerPath(projectId, asset.id, version.id)} prefetch={false} className="font-medium underline-offset-4 hover:underline">
                                        {t('Version {number}', { number: version.number ?? '–' })} · {version.filename}</Link>
                                    : <span>{version.filename} · {t(versionLabels[version.status])}</span>}
                                {version.failure && <p className="m-0 text-destructive">{t(version.failure)}</p>}
                            </div>
                            {(version.status === 'pending' || version.status === 'processing') &&
                                <Button size="sm" variant="outline" disabled={Boolean(mutation.progress)} onClick={() => {
                                    void mutation.run('Processing file…', async () => { await finalize(asset.id, version.id); });
                                }}>{t('Check upload')}</Button>}
                        </li>
                    ))}
                </ul>}
            </section>
            <form className="grid gap-3 border-t pt-4" onSubmit={event => {
                event.preventDefault();
                const fields = new FormData(event.currentTarget);
                void mutation.run('Saving…', async () => {
                    const updated = await proofWrite<{ asset: ProofAsset }>(route, 'PATCH', { name: name.trim(), collectionId: collectionId === 'none' ? null : collectionId, position: position(fields) });
                    setAsset(updated.asset);
                    refresh();
                });
            }}>
                <Field>
                    <FieldLabel htmlFor={`${id}-rename`}>{t('File name')}</FieldLabel>
                    <Input id={`${id}-rename`} value={name} onChange={event => setName(event.target.value)} required maxLength={120} />
                </Field>
                <CollectionField {...{ id, collectionId, collections, setCollectionId }} />
                <PositionField id={id} position={asset.position} />
                <Button type="submit" variant="outline" disabled={Boolean(mutation.progress)} className="justify-self-start">{t('Save')}</Button>
            </form>
            {asset.currentVersionId && <ProofShares api={api} scope={{ kind: 'asset', id: asset.id }} enabled={guestSharing} settingsHref={reviewSettingsHref} />}
            <DialogFooter>
                {confirm && <Button variant="outline" onClick={() => setConfirm(false)}>{t('Cancel')}</Button>}
                <Button variant={confirm ? 'destructive' : 'outline'} disabled={Boolean(mutation.progress)} onClick={() => {
                    if (!confirm) return setConfirm(true);
                    void mutation.run('Deleting…', async () => { await proofWrite(route, 'DELETE'); refresh(); close(); });
                }}>{t(confirm ? 'Confirm deletion' : 'Delete file')}</Button>
            </DialogFooter>
        </>}
    </>;
}

function CollectionField({ id, collectionId, collections, setCollectionId }: {
    id: string; collectionId: string; collections: ProofCollection[]; setCollectionId: (value: string) => void;
}) {
    const { t } = useAppI18n();
    return <Field>
        <FieldLabel htmlFor={`${id}-collection`}>{t('Collection')}</FieldLabel>
        <ProofSelect id={`${id}-collection`} label={t('Collection')} value={collectionId} onChange={setCollectionId}
            items={[{ value: 'none', label: t('No collection') }, ...collections.map(collection => ({ value: collection.id, label: collection.name }))]} />
    </Field>;
}
