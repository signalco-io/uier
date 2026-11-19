'use client';

import { useEffect, useId, useState, useTransition, type ReactNode } from 'react';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { useAppI18n } from '@/src/lib/i18n/client';
import { proofApiPath } from '@/src/lib/proofs/model';
import { proofErrorMessage, proofFetch, proofWrite } from './client';

type ViewerRoute = { projectId: string; assetId: string };
type FollowState = { following: boolean; pending: boolean };
const assetEndpoint = ({ projectId, assetId }: ViewerRoute) => `${proofApiPath(projectId)}/assets/${encodeURIComponent(assetId)}`;

function MailboxInput({ email, onChange, busy }: { email: string; onChange: (value: string) => void; busy: boolean }) {
    const id = useId();
    const { t } = useAppI18n();
    return <Field>
        <FieldLabel htmlFor={id}>{t('Email')}</FieldLabel>
        <Input id={id} type="email" autoComplete="email" value={email} maxLength={254} required disabled={busy}
            onChange={event => onChange(event.target.value)} />
    </Field>;
}

export function ProofThreadFollow({ endpoint, onUnfollow }: { endpoint: string; onUnfollow?: () => void }) {
    const { t } = useAppI18n();
    const [state, setState] = useState<FollowState>();
    const [editing, setEditing] = useState(false);
    const [email, setEmail] = useState('');
    const [verificationUrl, setVerificationUrl] = useState<string>();
    const [error, setError] = useState<string>();
    const [busy, start] = useTransition();

    useEffect(() => {
        const controller = new AbortController();
        void proofFetch<FollowState>(endpoint, { signal: controller.signal }).then(setState, error => {
            if (!controller.signal.aborted) setError(proofErrorMessage(error));
        });
        return () => controller.abort();
    }, [endpoint]);

    const follow = (following: boolean) => start(async () => {
        setError(undefined);
        try {
            const result = await proofWrite<{ verificationUrl?: string }>(endpoint, 'POST', { following, ...(following ? { email } : {}) });
            setState({ following: false, pending: following });
            setVerificationUrl(result.verificationUrl);
            setEditing(false);
            setEmail('');
            if (!following) onUnfollow?.();
        } catch (error) {
            setError(proofErrorMessage(error));
        }
    });

    return <div className="flex flex-col items-start gap-2">
        {state?.pending && <p role="status" className="text-sm text-muted-foreground">{t('Check your email to confirm this follow.')}</p>}
        {state?.following && <p className="text-sm text-muted-foreground">{t('You’re following this thread.')}</p>}
        {verificationUrl && <a className={buttonVariants({ size: 'sm', variant: 'outline' })} href={verificationUrl}>{t('Open local confirmation link')}</a>}
        {(state?.following || state?.pending) && <Button size="sm" variant="outline" className="pointer-coarse:min-h-11" disabled={busy}
            onClick={() => follow(false)}>{t(state.following ? 'Unfollow thread' : 'Cancel email confirmation')}</Button>}
        {state && !state.pending && !state.following && (editing ?
            <form className="w-full" aria-label={t('Follow thread')} onSubmit={event => { event.preventDefault(); follow(true); }}>
                <FieldGroup className="gap-3">
                    <MailboxInput email={email} onChange={setEmail} busy={busy} />
                    <FieldDescription>{t('Follow your thread for email updates and reopen your fix checks on another device.')}</FieldDescription>
                    <div className="flex flex-wrap gap-2">
                        <Button type="submit" size="sm" className="pointer-coarse:min-h-11" disabled={busy}>{t('Send confirmation email')}</Button>
                        <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" disabled={busy} onClick={() => setEditing(false)}>{t('Cancel')}</Button>
                    </div>
                </FieldGroup>
            </form> : <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" onClick={() => setEditing(true)}>{t('Follow thread')}</Button>)}
        {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
    </div>;
}

export function ProofReviewRecovery(route: ViewerRoute) {
    const { t } = useAppI18n();
    const [expanded, setExpanded] = useState(false);
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string>();
    const [busy, start] = useTransition();

    if (!expanded) return <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" onClick={() => setExpanded(true)}>
        {t('Recover guest review')}
    </Button>;
    return <form className="w-full max-w-sm rounded-xl border p-3" aria-label={t('Recover guest review')}
        onSubmit={event => {
            event.preventDefault();
            start(async () => {
                setError(undefined);
                try {
                    await proofWrite(`${assetEndpoint(route)}/returning`, 'POST', { action: 'recover', email });
                    setEmail('');
                    setSent(true);
                } catch (error) { setError(proofErrorMessage(error)); }
            });
        }}>
        <FieldGroup className="gap-3">
            <MailboxInput email={email} onChange={setEmail} busy={busy} />
            <FieldDescription>{t('Use the email address you confirmed when you followed your file thread.')}</FieldDescription>
            <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" className="pointer-coarse:min-h-11" disabled={busy}>{t('Send recovery link')}</Button>
                <Button size="sm" variant="ghost" className="pointer-coarse:min-h-11" disabled={busy} onClick={() => {
                    setExpanded(false); setEmail(''); setSent(false); setError(undefined);
                }}>{t('Cancel')}</Button>
            </div>
            {sent && <p role="status" className="text-sm text-muted-foreground">{t('If this address follows a thread on this file, we’ll send a recovery link.')}</p>}
            {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
        </FieldGroup>
    </form>;
}

export function ProofReturningGate({ children, ...route }: ViewerRoute & { children: ReactNode }) {
    const { t } = useAppI18n();
    const [link, setLink] = useState<{ token: string; confirm: boolean }>();
    const [error, setError] = useState<string>();
    const [busy, start] = useTransition();

    useEffect(() => {
        const readLink = () => {
            const url = new URL(window.location.href);
            const fragment = new URLSearchParams(url.hash.slice(1));
            const token = fragment.get('reviewer');
            if (token === null) return;
            setError(undefined);
            setLink({ token, confirm: fragment.get('follow') === '1' });
            // Remove the mailbox credential from the address and browser history before any interaction.
            window.history.replaceState(null, '', url.pathname + url.search);
        };
        readLink();
        window.addEventListener('hashchange', readLink);
        return () => window.removeEventListener('hashchange', readLink);
    }, []);

    if (!link) return children;
    return <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-start gap-4 px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold">{t(link.confirm ? 'Confirm file thread follow' : 'Resume file review')}</h1>
        <p className="text-sm text-muted-foreground">{t(link.confirm ? 'Confirm this email address to follow your thread and return to your fix checks.' : 'Open the file with the guest identity that received this link.')}</p>
        <div className="flex flex-wrap gap-2">
            <Button className="pointer-coarse:min-h-11" disabled={busy} onClick={() => start(async () => {
                setError(undefined);
                try {
                    const { href } = await proofWrite<{ href: string }>(`${assetEndpoint(route)}/returning`, 'POST', { action: 'open', token: link.token });
                    if (href === window.location.pathname + window.location.search) window.location.reload();
                    else window.location.replace(href);
                } catch (error) { setError(proofErrorMessage(error)); }
            })}>{t(link.confirm ? 'Confirm email and open file' : 'Open file review')}</Button>
            <Button variant="ghost" className="pointer-coarse:min-h-11" disabled={busy} onClick={() => setLink(undefined)}>{t('Cancel')}</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
        {error && <ProofReviewRecovery {...route} />}
    </main>;
}
