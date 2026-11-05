import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { useComments, newLocalId } from '../hooks/useComments';
import { useParticipants } from '../hooks/useParticipants';
import { displayedVerification, readyForReview, verificationDescription } from '../verification';
import type { CommentItem } from './@types/Comments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useAnnounce } from './Announcer';

/** The same workflow for pin popovers and inbox threads; guests see only their authorized actions. */
export function CommentVerification({ comment }: { comment: CommentItem }) {
    const p = comment.verificationPermissions;
    const v = displayedVerification(comment);
    const ready = readyForReview(comment);
    const [open, setOpen] = useState(false);
    const [restoreFocus, setRestoreFocus] = useState(false);
    const section = useRef<HTMLElement>(null);
    const [reviewer, setReviewer] = useState(p?.defaultReviewer ? 'author' : '');
    const [summary, setSummary] = useState('');
    const [fixUrl, setFixUrl] = useState('');
    const people = useParticipants(comment.id, open);
    const { verification } = useComments();
    const announce = useAnnounce();
    const trigger = useRef<HTMLButtonElement>(null);
    const form = useRef<HTMLFormElement>(null);
    const attempt = useRef<{ value: string; key: string } | null>(null);
    const id = useId();
    useEffect(() => { if (open) form.current?.querySelector('input')?.focus(); }, [open]);
    useEffect(() => {
        if (restoreFocus && !verification.isPending) { trigger.current?.focus(); setRestoreFocus(false); }
    }, [restoreFocus, verification.isPending]);
    if (!p?.request && !p?.respond && !p?.override && !p?.cancel && !v) return null;
    const reviewers = people.data?.filter(person => person.id !== p?.selfId) ?? [];
    // Nobody but you can check it: say so instead of an empty choice
    const noReviewers = !p?.defaultReviewer && !people.isLoading && !people.error && !reviewers.length;
    async function send(action: 'request' | 'confirm' | 'reject' | 'cancel', override = false) {
        const surface = section.current?.getRootNode() as Document | ShadowRoot | undefined;
        const fallback = surface?.querySelector<HTMLButtonElement>('[aria-label="Show comments"] button[aria-pressed="true"]')
            ?? surface?.querySelector<HTMLButtonElement>('button[aria-label^="Inbox"]');
        const input = action === 'request'  ? { action, reviewerId: reviewer, summary, fixUrl, expectedRevision: v?.revision ?? null }
            : { action, override, expectedRevision: v?.revision ?? null };
        const value = JSON.stringify(input);
        if (attempt.current?.value !== value) attempt.current = { value, key: newLocalId() };
        try {
            await verification.mutateAsync({ commentId: comment.id, input: { ...input, idempotencyKey: attempt.current.key } });
            attempt.current = null; setOpen(false); setSummary(''); setFixUrl(''); if (trigger.current?.isConnected) setRestoreFocus(true); else fallback?.focus();
            announce('Verification saved');
        } catch { /* Keep details and submission identity for retry. */ }
    }
    return <section ref={section} aria-label="Fix verification" className="flex flex-col gap-2 text-sm">
        {v && <>
            <p className="m-0 whitespace-pre-wrap break-words">{verificationDescription(v)}</p>
            {v.summary && <p className="m-0 whitespace-pre-wrap break-words">{v.summary}</p>}
            {v.fixUrl && <a className="self-start underline underline-offset-2" href={v.fixUrl} target="_blank" rel="noopener noreferrer">Open fix link</a>}
        </>}
        <div className="flex flex-wrap gap-1">
            {p?.request && <Button ref={trigger} size="sm" variant="outlined" aria-expanded={open} disabled={verification.isPending} onClick={() => setOpen(!open)}>{v?.outcome === 'pending' ? 'Request a new check' : 'Request verification'}</Button>}
            {ready && p?.respond && <><Button size="sm" disabled={verification.isPending} onClick={() => send('confirm')}>Confirm fix</Button><Button size="sm" variant="outlined" disabled={verification.isPending} onClick={() => send('reject')}>Still needs work</Button></>}
            {ready && p?.override && <><Button size="sm" variant="outlined" disabled={verification.isPending} onClick={() => send('confirm', true)}>Confirm fix as admin</Button><Button size="sm" variant="outlined" disabled={verification.isPending} onClick={() => send('reject', true)}>Still needs work as admin</Button></>}
            {ready && p?.cancel && <Button size="sm" variant="plain" disabled={verification.isPending} onClick={() => send('cancel')}>Cancel request</Button>}
        </div>
        {open && <form ref={form} aria-label="Request verification" className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void send('request'); }}>
            <Input id={`${id}-summary`} label="Fix summary" maxLength={500} value={summary} onChange={event => setSummary(event.target.value)} disabled={verification.isPending} />
            <Input id={`${id}-link`} type="url" label="Fix link (optional)" maxLength={2048} value={fixUrl} onChange={event => setFixUrl(event.target.value)} disabled={verification.isPending} />
            {noReviewers ? (
                <p id={`${id}-reviewer-help`} className="m-0 text-muted-foreground">Nobody else can check this fix yet. The reviewer needs access to this project, and it can&apos;t be you.</p>
            ) : <>
                <div role="group" aria-label="Reviewer" className="flex flex-wrap gap-1">
                    {p?.defaultReviewer && <Button size="sm" variant="outlined" aria-pressed={reviewer === 'author'} onClick={() => setReviewer('author')}>Original author</Button>}
                    {reviewers.map(person => <Button key={person.id} size="sm" variant="outlined" aria-pressed={reviewer === person.id} onClick={() => setReviewer(person.id)}>{person.name}</Button>)}
                </div>
                {!reviewer && <p id={`${id}-reviewer-help`} className="m-0 text-muted-foreground">{people.isLoading && !p?.defaultReviewer ? 'Loading reviewers…' : 'Choose a reviewer to send the request.'}</p>}
            </>}
            <CommentsErrorMessage error={people.error} />
            <div className="flex gap-1"><Button size="sm" type="submit" disabled={verification.isPending || !reviewer} aria-describedby={reviewer ? undefined : `${id}-reviewer-help`}>Request check</Button>
                <Button size="sm" variant="plain" disabled={verification.isPending} onClick={() => { setOpen(false); trigger.current?.focus(); }}>Close</Button></div>
        </form>}
        {verification.isPending && <p role="status" className="m-0">Saving verification…</p>}
        <CommentsErrorMessage error={verification.error} />
    </section>;
}
