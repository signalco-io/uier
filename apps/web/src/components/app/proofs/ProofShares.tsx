'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ProofShare, ProofShareScope } from '@/src/lib/proofs/model';
import { proofErrorMessage, proofFetch, proofWrite } from './client';
import { ProofSelect } from './ProofSelect';

export function ProofShares({ api, scope, enabled, settingsHref }: {
    api: string; scope: ProofShareScope; enabled: boolean; settingsHref?: string;
}) {
    const { t, language } = useAppI18n();
    const id = useId();
    const [shares, setShares] = useState<ProofShare[]>();
    const [permission, setPermission] = useState<ProofShare['permission']>('comment');
    const [downloadOriginal, setDownloadOriginal] = useState(false);
    const [url, setUrl] = useState('');
    const [copied, setCopied] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    const route = `${api}/shares`;
    const scopeId = scope.id;
    const scopeKind = scope.kind;
    useEffect(() => {
        const controller = new AbortController();
        proofFetch<{ shares: ProofShare[] }>(route, { signal: controller.signal }).then(
            result => setShares(result.shares.filter(share => share.scope.id === scopeId && share.scope.kind === scopeKind)),
            error => { if (!controller.signal.aborted) setError(proofErrorMessage(error)); }
        );
        return () => controller.abort();
    }, [route, scopeId, scopeKind, attempt]);

    async function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const date = String(new FormData(event.currentTarget).get('expires') ?? '');
        setError('');
        setPending(true);
        try {
            const response = await proofWrite<{ share: ProofShare; url: string }>(route, 'POST', {
                scope, permission, downloadOriginal, ...(date ? { expiresAt: new Date(date).toISOString() } : {})
            });
            setShares(existing => [response.share, ...(existing ?? [])]);
            setCopied(false);
            setUrl(new URL(response.url, location.origin).href);
        } catch (error) {
            setError(proofErrorMessage(error));
        } finally {
            setPending(false);
        }
    }

    async function revoke(share: ProofShare) {
        setError('');
        setPending(true);
        try {
            await proofWrite(`${route}/${encodeURIComponent(share.id)}`, 'DELETE');
            setShares(existing => existing?.map(item => item.id === share.id ? { ...item, revokedAt: new Date().toISOString() } : item));
            setUrl('');
        } catch (error) {
            setError(proofErrorMessage(error));
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex flex-col gap-4">
            {enabled ? (
                <form className="grid gap-3" onSubmit={create}>
                    <Field>
                        <FieldLabel htmlFor={`${id}-permissions`}>{t('Link permissions')}</FieldLabel>
                        <ProofSelect id={`${id}-permissions`} label={t('Link permissions')} value={permission}
                            items={[{ value: 'view', label: t('View only') }, { value: 'comment', label: t('View and comment') }]}
                            onChange={value => setPermission(value === 'view' ? 'view' : 'comment')} />
                    </Field>
                    <FieldLabel className="gap-2"><Checkbox checked={downloadOriginal} onCheckedChange={setDownloadOriginal} />{t('Allow original download')}</FieldLabel>
                    <Field>
                        <FieldLabel htmlFor={`${id}-expires`}>{t('Expires (optional)')}</FieldLabel>
                        <Input id={`${id}-expires`} name="expires" type="datetime-local" />
                    </Field>
                    <Button type="submit" className="justify-self-start" disabled={pending || !shares}>{t('Create review link')}</Button>
                </form>
            ) : (
                <div className="flex flex-col items-start gap-2">
                    <p className="m-0 text-sm text-muted-foreground">{t('Guest sharing is off in this project’s review settings.')}</p>
                    {settingsHref && <Link href={settingsHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{t('Review settings')}</Link>}
                </div>
            )}
            {url && (
                <Field>
                    <FieldLabel htmlFor={`${id}-url`}>{t('Review link')}</FieldLabel>
                    <div className="flex gap-2">
                        <Input id={`${id}-url`} readOnly value={url} onFocus={event => event.currentTarget.select()} />
                        <Button variant="outline" onClick={() => {
                            navigator.clipboard.writeText(url).then(() => setCopied(true), () => setError('Copy the link from the field.'));
                        }}>{t(copied ? 'Copied' : 'Copy link')}</Button>
                    </div>
                </Field>
            )}
            {error && <p role="alert" className="m-0 text-sm text-destructive">{t(error)}</p>}
            {!shares && (error
                ? <Button variant="outline" onClick={() => { setError(''); setAttempt(value => value + 1); }}>{t('Retry')}</Button>
                : <p role="status" className="m-0 text-sm text-muted-foreground">{t('Loading review links…')}</p>)}
            {shares && shares.length > 0 && (
                <ul className="m-0 list-none divide-y rounded-lg border p-0">
                    {shares.map(share => {
                        const state = share.revokedAt ? 'Revoked' : share.expiresAt && Date.parse(share.expiresAt) <= Date.now() ? 'Expired' : null;
                        return (
                            <li key={share.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                                <div>
                                    <p className="m-0">{t(share.permission === 'comment' ? 'View and comment' : 'View only')}</p>
                                    <p className="m-0 text-muted-foreground">{new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(share.createdAt))}</p>
                                </div>
                                {state ? <span>{t(state)}</span> : <Button size="sm" variant="outline" disabled={pending} onClick={() => void revoke(share)}>{t('Revoke')}</Button>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
