'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Field, FieldLabel } from '@/src/components/ui/field';
import { Spinner } from '@/src/components/ui/spinner';
import { CopyBlock } from '../CopyBlock';

type Result = { kind: 'checking' | 'success' | 'failure' | 'inconclusive'; message: string };
const failures: Record<string, Result> = {
    csp_connect: { kind: 'failure', message: 'The browser blocked the review API with connect-src. Add the API origin to the site’s security headers.' },
    csp_frame: { kind: 'failure', message: 'The browser blocked verification with frame-src. Add the API origin to frame-src.' },
    csp_script: { kind: 'failure', message: 'The browser blocked a required uier script. Check script-src in the security headers.' },
    comments_disabled: { kind: 'failure', message: 'The toolbar is installed, but comments are turned off in project settings.' },
    sign_in_required: { kind: 'failure', message: 'The toolbar loaded, but the reviewer could not sign in. Retry from this app and check project access.' },
    verification_failed: { kind: 'failure', message: 'The API responded, but browser verification failed. Check frame-src and retry.' },
    api_unreachable: { kind: 'inconclusive', message: 'The toolbar loaded, but the review API could not be reached. Check the project’s site addresses, connect-src and your connection, then retry.' }
};

/** Observes the actual site via a nonce-bound, source/origin-checked diagnostic handshake. */
export function InstallationCheck({ projectId, urls }: { projectId: string; urls: string[] }) {
    const [address, setAddress] = useState(urls[0] ?? '');
    const [result, setResult] = useState<Result>();
    const popupRef = useRef<Window>(undefined);
    const cleanup = useRef<() => void>(() => undefined);
    useEffect(() => () => cleanup.current(), []);
    const checking = result?.kind === 'checking';
    const stop = (next: Result) => { cleanup.current(); setResult(next); };
    const start = () => {
        cleanup.current();
        popupRef.current?.close();
        const target = new URL(address);
        const nonce = crypto.randomUUID();
        target.searchParams.set('uier-check', nonce);
        const review = new URL(`/app/review/${projectId}`, location.origin);
        review.searchParams.set('url', target.href);
        const popup = window.open('about:blank', '_blank');
        if (!popup) { setResult({ kind: 'inconclusive', message: 'The check window was blocked. Allow popups for uier and retry.' }); return; }
        // Disown the popup's opener while retaining the reference used to check message sources.
        popup.opener = null;
        popupRef.current = popup;
        setResult({ kind: 'checking', message: 'Opening the site and waiting for its toolbar.' });
        const receive = (event: MessageEvent) => {
            const data = event.data;
            if (event.source !== popup || event.origin !== target.origin || data?.type !== 'uier:installation' || data.nonce !== nonce) return;
            if (data.project !== projectId) { stop({ kind: 'failure', message: 'This page loads a toolbar for a different project. Replace its script with this project’s snippet.' }); return; }
            if (data.apiOrigin !== location.origin) { stop({ kind: 'failure', message: 'The toolbar points to a different uier API. Copy the script from this install guide and retry.' }); return; }
            if (data.stage === 'ready') stop({ kind: 'success', message: 'Installation confirmed. The correct toolbar, review API and browser verification work on this page.' });
            else if (data.stage === 'failed') stop((typeof data.code === 'string' && Object.hasOwn(failures, data.code) ? failures[data.code] : undefined)
                ?? { kind: 'inconclusive', message: 'The check could not finish. Check the script and security headers, then retry.' });
            else if (data.stage === 'api') setResult({ kind: 'checking', message: 'The toolbar and API responded. Checking browser verification.' });
        };
        window.addEventListener('message', receive);
        const ping = () => {
            if (popup.closed) { stop({ kind: 'inconclusive', message: 'The check window closed or disconnected before confirmation. Retry and leave it open.' }); return; }
            try { popup.postMessage({ type: 'uier:installation-ping', nonce }, target.origin); }
            catch { stop({ kind: 'inconclusive', message: 'The check window disconnected. Retry and leave it open.' }); }
        };
        const interval = window.setInterval(ping, 400);
        window.addEventListener('focus', ping);
        const timeout = window.setTimeout(() => stop({ kind: 'inconclusive', message: 'No complete confirmation arrived. The site may be private, unreachable, missing the script or blocking it. Check the snippet and security headers, then retry.' }), 30_000);
        cleanup.current = () => { clearInterval(interval); clearTimeout(timeout); window.removeEventListener('message', receive); window.removeEventListener('focus', ping); };
        popup.location.href = review.href;
    };
    const reviewLink = new URL(address);
    reviewLink.searchParams.set('toolbar-code', projectId);
    return (
        <section aria-label="Check installation" className="flex flex-col gap-3 rounded-xl border p-4">
            <h3 className="m-0 text-sm font-medium">Check installation</h3>
            <p className="m-0 text-sm text-muted-foreground">Open the actual site to check its toolbar and connection. Owners install the script once. Reviewers need no extension.</p>
            <Field>
                <FieldLabel htmlFor={`installation-${projectId}`}>Site to check</FieldLabel>
                <Select value={address} onValueChange={next => { cleanup.current(); setAddress(next); setResult(undefined); }} disabled={checking}>
                    <SelectTrigger id={`installation-${projectId}`} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{urls.map(url => <SelectItem key={url} value={url}>{url}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
            </Field>
            <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={start} disabled={checking}>{checking && <Spinner data-icon="inline-start" />}{checking ? 'Checking installation...' : result ? 'Retry installation check' : 'Check installation'}</Button>
                {checking && <Button type="button" variant="outline" onClick={() => {
                    popupRef.current?.close(); stop({ kind: 'inconclusive', message: 'Check canceled. Retry when the site is ready.' });
                }}>Cancel check</Button>}
            </div>
            {result && <p role="status" aria-label="Installation result" data-result={result.kind} className="m-0 text-sm">{result.message}</p>}
            {result?.kind === 'success' && <>
                <Button variant="outline" asChild><a href={reviewLink.href} target="_blank" rel="noopener">Open checked review</a></Button>
                <CopyBlock value={reviewLink.href} label="Copy checked review link" />
            </>}
        </section>
    );
}
