'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { useAppI18n } from '@/src/lib/i18n/client';
import { proofFormats, type ProofAsset, type ProofFigmaFrame, type ProofFormat, type ProofVersion } from '@/src/lib/proofs/model';
import { proofErrorMessage, proofFetch, proofWrite, ProofRequestError } from './client';

export type ProofUploadSettings = { formats: ProofFormat[]; canEdit: boolean; htmlAvailable: boolean };

const formatNames: Record<ProofFormat, string> = { image: 'Images', pdf: 'PDFs', figma: 'Figma', video: 'Videos', email: 'Emails', html: 'HTML prototypes' };

export function ProofFormatSettings({ api, settings, onSave, onBusy }: {
    api: string; settings: ProofUploadSettings; onSave: (formats: ProofFormat[]) => void; onBusy: (value: boolean) => void;
}) {
    const { t } = useAppI18n();
    const [formats, setFormats] = useState(settings.formats);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPending(true);
        setError('');
        onBusy(true);
        try {
            const result = await proofWrite<{ formats: ProofFormat[] }>(`${api}/settings`, 'PATCH', { formats });
            onSave(result.formats);
        } catch (reason) {
            setError(proofErrorMessage(reason));
        } finally {
            setPending(false);
            onBusy(false);
        }
    }
    return <form onSubmit={save} className="grid gap-3">
        {proofFormats.map(format => <FieldLabel key={format} className="gap-2">
            <Checkbox checked={formats.includes(format)} disabled={pending || (format === 'html' && !settings.htmlAvailable && !formats.includes('html'))}
                onCheckedChange={checked => setFormats(current => checked ? [...current, format] : current.filter(item => item !== format))} />
            {t(formatNames[format])}
        </FieldLabel>)}
        {!settings.htmlAvailable && <FieldDescription>{t('HTML prototypes require a separate preview host.')}</FieldDescription>}
        {error && <p role="alert" className="m-0 text-destructive">{t(error)}</p>}
        <Button type="submit" disabled={pending} className="justify-self-start">{t(pending ? 'Saving…' : 'Save')}</Button>
    </form>;
}

export function FigmaImport({ api, asset, version, onAsset, onVersion, onBusy }: {
    api: string; asset?: ProofAsset; version?: ProofVersion | null; onAsset: (asset: ProofAsset) => void;
    onVersion: (version: ProofVersion) => void; onBusy: (busy: boolean) => void;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const [url, setUrl] = useState(version?.manifest?.figma?.url ?? '');
    const token = useRef<HTMLInputElement>(null);
    const [discovery, setDiscovery] = useState<{ name: string; frames: ProofFigmaFrame[]; url: string }>();
    const [selected, setSelected] = useState<string[]>([]);
    const [pending, setPending] = useState('');
    const [error, setError] = useState('');
    const request = useRef<{ key: string; id: string } | undefined>(undefined);
    const savedAsset = useRef(asset);

    function run(message: string, task: () => Promise<void>) {
        if (pending) return;
        setPending(message);
        setError('');
        onBusy(true);
        void task().catch(error => {
            if (error instanceof ProofRequestError && [409, 422].includes(error.status)) request.current = undefined;
            setError(proofErrorMessage(error));
        }).finally(() => { setPending(''); onBusy(false); });
    }

    function inspect(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const credential = token.current?.value.trim();
        if (!credential) return;
        setDiscovery(undefined);
        run('Loading Figma frames…', async () => {
            const result = await proofWrite<{ name: string; frames: ProofFigmaFrame[] }>(`${api}/figma/frames`, 'POST', { url, token: credential });
            setDiscovery({ ...result, url });
            setSelected(version?.manifest?.figma?.selectedIds ?? []);
        });
    }

    function publish() {
        const credential = token.current?.value.trim();
        if (!discovery || discovery.url !== url || !credential || !selected.length) return;
        run('Importing Figma frames…', async () => {
            let target = savedAsset.current;
            if (!target) {
                const result = await proofWrite<{ asset: ProofAsset }>(`${api}/assets`, 'POST', { name: discovery.name.slice(0, 160) });
                target = result.asset;
                savedAsset.current = target;
                onAsset(target);
            }
            const expectedVersionId = target.currentVersionId;
            const input = { url, frameIds: selected, expectedVersionId };
            const key = JSON.stringify(input);
            const attempt = request.current?.key === key ? request.current : { key, id: crypto.randomUUID() };
            request.current = attempt;
            const { version } = await proofWrite<{ version: ProofVersion }>(`${api}/assets/${encodeURIComponent(target.id)}/figma`, 'POST', {
                ...input, token: credential, requestId: attempt.id
            });
            if (version.status === 'failed') throw new ProofRequestError(422, version.failure ?? 'The file could not be processed.');
            if (version.status === 'published') savedAsset.current = { ...target, currentVersionId: version.id };
            if (token.current) token.current.value = '';
            setDiscovery(undefined);
            request.current = undefined;
            onVersion(version);
        });
    }

    const discovered = discovery?.url === url ? discovery : undefined;
    const selectedAvailable = discovered?.frames.some(frame => selected.includes(frame.id));
    return <div className="grid gap-3">
        <form className="grid gap-3" onSubmit={inspect}>
            <Field>
                <FieldLabel htmlFor={`${id}-url`}>{t('Figma file link')}</FieldLabel>
                <Input id={`${id}-url`} type="url" maxLength={2048} required value={url} disabled={Boolean(pending)} onChange={event => setUrl(event.target.value)} />
            </Field>
            <Field>
                <FieldLabel htmlFor={`${id}-token`}>{t('Figma access token')}</FieldLabel>
                <Input ref={token} id={`${id}-token`} type="password" autoComplete="off" required maxLength={512} disabled={Boolean(pending)} />
                <FieldDescription>{t('Your token is used for this import and is never saved.')}</FieldDescription>
            </Field>
            <Button type="submit" variant="outline" className="justify-self-start" disabled={Boolean(pending)}>{t('Find frames')}</Button>
        </form>
        {discovered && <>
            <fieldset className="grid max-h-60 gap-3 overflow-auto rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">{discovered.name}</legend>
                {discovered.frames.map(item => <FieldLabel key={item.id} className="gap-2">
                    <Checkbox checked={selected.includes(item.id)} disabled={Boolean(pending) || (selected.length >= 20 && !selected.includes(item.id))} onCheckedChange={checked =>
                        setSelected(current => checked ? [...current, item.id] : current.filter(frame => frame !== item.id))} />
                    <span className="break-words">{item.page} · {item.name}</span>
                </FieldLabel>)}
            </fieldset>
            <Button type="button" className="justify-self-start" disabled={Boolean(pending) || !selectedAvailable} onClick={publish}>
                {t(version?.manifest?.figma ? 'Resync selected frames' : 'Import selected frames')}
            </Button>
        </>}
        {pending && <p role="status" className="m-0 text-sm text-muted-foreground">{t(pending)}</p>}
        {error && <p role="alert" className="m-0 text-sm text-destructive">{t(error)}</p>}
    </div>;
}

type EmailAddress = { available: boolean; active: boolean; address?: string };

export function ProofEmailAddress({ route, onBusy }: { route: string; onBusy: (busy: boolean) => void }) {
    const { t } = useAppI18n();
    const id = useId();
    const [address, setAddress] = useState<EmailAddress>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const endpoint = `${route}/email-address`;
    useEffect(() => {
        const controller = new AbortController();
        void proofFetch<EmailAddress>(endpoint, { signal: controller.signal }).then(
            result => { if (!controller.signal.aborted) setAddress(result); },
            error => { if (!controller.signal.aborted) setError(proofErrorMessage(error)); }
        );
        return () => controller.abort();
    }, [endpoint]);

    async function update(method: 'POST' | 'DELETE') {
        setError('');
        setBusy(true);
        onBusy(true);
        try {
            setAddress(await proofWrite<EmailAddress>(endpoint, method));
        } catch (reason) {
            setError(proofErrorMessage(reason));
        } finally {
            setBusy(false);
            onBusy(false);
        }
    }
    return <section aria-labelledby={`${id}-title`} className="grid gap-2 border-t pt-4">
        <h3 id={`${id}-title`} className="m-0 font-medium">{t('Test email address')}</h3>
        {address && !address.available && <p className="m-0 text-muted-foreground">{t('Test email delivery is unavailable.')}</p>}
        {address?.available && <div className="grid gap-2">
            {address.address && <Field>
                <FieldLabel htmlFor={`${id}-address`}>{t('Send a test email to')}</FieldLabel>
                <Input id={`${id}-address`} readOnly value={address.address} onFocus={event => event.currentTarget.select()} />
            </Field>}
            <div className="flex flex-wrap gap-2">
                <Button variant="outline" type="button" size="sm" disabled={busy} onClick={() => void update('POST')}>
                    {t(address.active ? 'Rotate test address' : 'Create test address')}
                </Button>
                {address.active && <Button variant="ghost" type="button" size="sm" disabled={busy} onClick={() => void update('DELETE')}>
                    {t('Disable test address')}
                </Button>}
            </div>
        </div>}
        {error && <p role="alert" className="m-0 text-destructive">{t(error)}</p>}
    </section>;
}
