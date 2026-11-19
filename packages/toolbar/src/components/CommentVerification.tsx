import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { useComments, newLocalId } from '../hooks/useComments';
import { useParticipants } from '../hooks/useParticipants';
import { displayedVerification, readyForReview } from '../verification';
import { useMessages, useToolbarLanguage } from '../i18n';
import { verificationText } from '../i18n/format';
import type { CommentItem } from './@types/Comments';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { CommentScreenshot } from './CommentScreenshot';
import { useAnnounce } from './Announcer';

/**
 * The same workflow for pin popovers and inbox threads; guests see only their authorized actions.
 * The Request verification form opens from Thread options (`open`); focus goes back to `returnFocus`.
 * `evidence` (a page check run again) goes between the request and the answers.
 */
export function CommentVerification({ comment, open, onOpenChange, returnFocus, evidence, statusId }: {
    statusId?: string;
    comment: CommentItem;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    returnFocus?: RefObject<HTMLButtonElement | null>;
    evidence?: ReactNode;
}) {
    const t = useMessages();
    const language = useToolbarLanguage();
    const p = comment.verificationPermissions;
    const v = displayedVerification(comment);
    const ready = readyForReview(comment);
    const setOpen = onOpenChange;
    const [restoreFocus, setRestoreFocus] = useState(false);
    const section = useRef<HTMLElement>(null);
    const [reviewer, setReviewer] = useState(p?.defaultReviewer ? 'author' : '');
    const [summary, setSummary] = useState('');
    const [fixUrl, setFixUrl] = useState('');
    const [afterScreenshotItemId, setAfterScreenshotItemId] = useState('');
    const people = useParticipants(comment.id, open);
    const { verification } = useComments();
    const announce = useAnnounce();
    const fallbackTrigger = useRef<HTMLButtonElement>(null);
    const trigger = returnFocus ?? fallbackTrigger;
    const form = useRef<HTMLFormElement>(null);
    const attempt = useRef<{ value: string; key: string } | null>(null);
    const id = useId();
    useEffect(() => { if (open) form.current?.querySelector('input')?.focus(); }, [open]);
    useEffect(() => {
        if (restoreFocus && !verification.isPending) { trigger.current?.focus(); setRestoreFocus(false); }
    }, [restoreFocus, verification.isPending]);
    if (comment.verificationEnabled !== true) return null;
    if (!v && !open && !verification.error) return null;
    const imageReplies = comment.hasDesignReference ? comment.thread.items.slice(1).filter(item => !item.deleted && !item.pending && item.screenshot) : [];
    const reviewers = people.data?.filter(person => person.id !== p?.selfId) ?? [];
    // Nobody but you can check it: say so instead of an empty choice
    const noReviewers = !p?.defaultReviewer && !people.isLoading && !people.error && !reviewers.length;
    async function send(action: 'request' | 'confirm' | 'reject' | 'cancel', override = false) {
        const surface = section.current?.getRootNode() as Document | ShadowRoot | undefined;
        // By their data attributes, not their names: the names are in the toolbar's language
        const fallback = surface?.querySelector<HTMLButtonElement>('[data-uier-status-tabs] button[aria-pressed="true"]')
            ?? surface?.querySelector<HTMLButtonElement>('button[data-uier-inbox-button]');
        const input = action === 'request'  ? { action, statusId, reviewerId: reviewer, summary, fixUrl, ...(afterScreenshotItemId ? { afterScreenshotItemId } : {}), expectedRevision: v?.revision ?? null }
            : { action, override, expectedRevision: v?.revision ?? null };
        const value = JSON.stringify(input);
        if (attempt.current?.value !== value) attempt.current = { value, key: newLocalId() };
        try {
            await verification.mutateAsync({ commentId: comment.id, input: { ...input, idempotencyKey: attempt.current.key } });
            attempt.current = null; setOpen(false); setSummary(''); setFixUrl(''); setAfterScreenshotItemId('');
            // Back to Thread options; a thread that left the list gives it to the inbox
            if (trigger.current?.isConnected) setRestoreFocus(true); else fallback?.focus();
            announce(t.verification.saved);
        } catch { /* Keep details and submission identity for retry. */ }
    }
    return <section ref={section} aria-label={t.verification.label} className="flex flex-col gap-2 text-sm">
        {v && <>
            <p className="m-0 whitespace-pre-wrap break-words">{verificationText(v, t, language)}</p>
            {v.summary && <p className="m-0 whitespace-pre-wrap break-words">{v.summary}</p>}
            {v.fixUrl && <a className="self-start underline underline-offset-2" href={v.fixUrl} target="_blank" rel="noopener noreferrer">{t.verification.openFixLink}</a>}
        </>}
        {v?.stagingEvidence && <div className="flex flex-wrap gap-3">
            {v.stagingEvidence.before && <div><p className="m-0">{t.staging.before}</p><CommentScreenshot comment={comment} /></div>}
            {v.stagingEvidence.afterItemId && <div><p className="m-0">{t.staging.after}</p><CommentScreenshot comment={comment} itemId={v.stagingEvidence.afterItemId} /></div>}
        </div>}
        {evidence}
        {/* Request verification is in Thread options; here, the reviewer's and requester's answers */}
        {ready && (p?.respond || p?.override || p?.cancel) && <div className="flex flex-wrap gap-1">
            {ready && p?.respond && <><Button size="sm" disabled={verification.isPending} onClick={() => send('confirm')}>{t.verification.confirmFix}</Button><Button size="sm" variant="outlined" disabled={verification.isPending} onClick={() => send('reject')}>{t.verification.stillNeedsWork}</Button></>}
            {ready && p?.override && <><Button size="sm" variant="outlined" disabled={verification.isPending} onClick={() => send('confirm', true)}>{t.verification.confirmFixAsAdmin}</Button><Button size="sm" variant="outlined" disabled={verification.isPending} onClick={() => send('reject', true)}>{t.verification.stillNeedsWorkAsAdmin}</Button></>}
            {ready && p?.cancel && <Button size="sm" variant="plain" disabled={verification.isPending} onClick={() => send('cancel')}>{t.verification.cancelRequest}</Button>}
        </div>}
        {open && <form ref={form} aria-label={t.verification.request} className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void send('request'); }}>
            <Input id={`${id}-summary`} label={t.verification.fixSummary} maxLength={500} value={summary} onChange={event => setSummary(event.target.value)} disabled={verification.isPending} />
            <Input id={`${id}-link`} type="url" label={t.verification.fixLink} maxLength={2048} value={fixUrl} onChange={event => setFixUrl(event.target.value)} disabled={verification.isPending} />
            {imageReplies.length > 0 && <label className="grid gap-1">
                {t.staging.after}
                <select className="min-h-11 rounded-md border bg-background px-2" value={afterScreenshotItemId} disabled={verification.isPending}
                    onChange={event => setAfterScreenshotItemId(event.target.value)}>
                    <option value="">{t.staging.noScreenshot}</option>
                    {imageReplies.map((item, index) => <option key={item.id} value={item.id}>{t.staging.replyImage(index + 1)}</option>)}
                </select>
            </label>}
            {noReviewers ? (
                <p id={`${id}-reviewer-help`} className="m-0 text-muted-foreground">{t.verification.noReviewers}</p>
            ) : <>
                <div role="group" aria-label={t.verification.reviewer} className="flex flex-wrap gap-1">
                    {p?.defaultReviewer && <Button type="button" size="sm" variant="outlined" aria-pressed={reviewer === 'author'} onClick={() => setReviewer('author')}>{t.verification.originalAuthor}</Button>}
                    {reviewers.map(person => <Button key={person.id} type="button" size="sm" variant="outlined" aria-pressed={reviewer === person.id} onClick={() => setReviewer(person.id)}>{person.name}</Button>)}
                </div>
                {!reviewer && <p id={`${id}-reviewer-help`} className="m-0 text-muted-foreground">{people.isLoading && !p?.defaultReviewer ? t.verification.loadingReviewers : t.verification.chooseReviewer}</p>}
            </>}
            <CommentsErrorMessage error={people.error} />
            <div className="flex gap-1"><Button size="sm" type="submit" disabled={verification.isPending || !reviewer} aria-describedby={reviewer ? undefined : `${id}-reviewer-help`}>{t.verification.request}</Button>
                <Button type="button" size="sm" variant="plain" disabled={verification.isPending} onClick={() => { setOpen(false); setRestoreFocus(true); }}>{t.common.cancel}</Button></div>
        </form>}
        {verification.isPending && <p role="status" className="m-0">{t.verification.saving}</p>}
        <CommentsErrorMessage error={verification.error} />
    </section>;
}
