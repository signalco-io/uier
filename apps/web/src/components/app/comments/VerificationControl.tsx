'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useEffect, useId, useRef, useState, useTransition, type RefObject, type ReactNode } from 'react';
import type { ProofVerificationEvidence } from '@/src/lib/proofs/threadModel';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';
import { displayedVerification, readyForReview } from '@uier/toolbar/verification';
import { verificationText } from '@/src/lib/comments/verificationText';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Textarea } from '@/src/components/ui/textarea';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Spinner } from '@/src/components/ui/spinner';
import { InviteButton } from '../users/InviteDialog';
import { commentParticipantsAction, verificationCommentAction } from './actions';


type ProofVerificationControl = {
    evidence?: ProofVerificationEvidence;
    targetVersionId?: string;
    requestTarget: ReactNode;
    evidenceView: ReactNode;
    participants: { id: string; name: string }[];
    save: (input: Record<string, unknown>, action: 'request' | 'confirm' | 'reject' | 'cancel') => Promise<{ ok: true } | { ok: false; error: string }>;
};

/**
 * A thread's fix check: what was requested and the reviewer's choices, and the Request verification
 * form. The form opens from the status menu's "Ready to verify" (`formOpen`); focus goes back to
 * `returnFocus` (the status menu) when it closes.
 */
export function VerificationControl({ projectId, userId, comment, formOpen, onFormOpenChange, returnFocus, statusId, proof }: {
    statusId?: string;
    projectId: string;
    userId: string;
    comment: Pick<ProjectCommentView, 'id' | 'resolved' | 'verificationEnabled' | 'verification' | 'verificationPermissions'>;
    proof?: ProofVerificationControl;
    formOpen: boolean;
    onFormOpenChange: (open: boolean) => void;
    returnFocus?: RefObject<HTMLElement | null>;
}) {
    const { t, language } = useAppI18n();
    const p = comment.verificationPermissions;
    const v = displayedVerification(comment);
    const ready = readyForReview(comment);
    // Who can check the fix, loaded when the form opens (undefined while loading)
    const [people, setPeople] = useState<{ id: string; name: string }[]>();
    const [reviewer, setReviewer] = useState(p?.defaultReviewer ? 'author' : '');
    const [summary, setSummary] = useState('');
    const [fixUrl, setFixUrl] = useState('');
    const [error, setError] = useState<string>();
    const [notice, setNotice] = useState<string>();
    const [restoreFocus, setRestoreFocus] = useState(false);
    const [pending, start] = useTransition();
    const first = useRef<HTMLTextAreaElement>(null);
    const attempt = useRef<{ value: string; key: string } | null>(null);
    const id = useId();
    useEffect(() => {
        if (!formOpen) return;
        first.current?.focus();
        if (proof) return;
        let current = true;
        setPeople(undefined);
        commentParticipantsAction(projectId, comment.id).then(result => {
            if (!current) return;
            if (result?.ok) setPeople(result.data);
            else { setPeople([]); setError(result?.error ?? t("Could not load reviewers.")); }
        }, () => { if (current) { setPeople([]); setError(t("Could not load reviewers.")); } });
        return () => { current = false; };
    }, [formOpen, projectId, comment.id, Boolean(proof)]);
    useEffect(() => {
        if (restoreFocus && !pending) { returnFocus?.current?.focus(); setRestoreFocus(false); }
    }, [restoreFocus, pending, returnFocus]);
    const responses = ready && (p?.respond || p?.override || p?.cancel);
    if (comment.verificationEnabled !== true) return proof?.evidenceView ?? null;
    if (!v && !formOpen && !responses && !pending && !error && !notice) return null;
    const send = (action: 'request' | 'confirm' | 'reject' | 'cancel', override = false) => start(async () => {
        const fallback = document.querySelector<HTMLInputElement>('input[data-shortcut-search]');
        const input = action === 'request' ? { action, ...(statusId ? { statusId } : {}), reviewerId: reviewer, summary, fixUrl, ...(proof ? { evidence: proof.evidence } : {}), expectedRevision: v?.revision ?? null }
            : { action, override, ...(proof ? { targetVersionId: proof.targetVersionId } : {}), expectedRevision: v?.revision ?? null };
        const value = JSON.stringify(input);
        if (attempt.current?.value !== value) attempt.current = { value, key: crypto.randomUUID() };
        setError(undefined); setNotice(undefined);
        try {
            const payload = { ...input, idempotencyKey: attempt.current.key };
            const result = proof ? await proof.save(payload, action) : await verificationCommentAction(projectId, comment.id, payload);
            if (!result?.ok) { setError(result?.error ?? t("Could not save verification. Try again.")); return; }
            attempt.current = null; onFormOpenChange(false); setSummary(''); setFixUrl('');
            setNotice(action === 'request' ? t("Verification requested.") : t("Verification saved."));
            if (proof) return;
            if (returnFocus?.current?.isConnected) setRestoreFocus(true); else fallback?.focus();
        } catch { setError(t("Could not save verification. Your details are kept. Try again.")); }
    });
    const close = () => { onFormOpenChange(false); returnFocus?.current?.focus(); };
    const reviewers = proof?.participants ?? people;
    const options = [...(p?.defaultReviewer ? [{ value: 'author', label: t("Original author") }] : []),
        ...(reviewers ?? []).filter(person => person.id !== userId).map(person => ({ value: person.id, label: person.name }))];
    // Nobody but you can check it: say so instead of an empty list
    const noReviewers = reviewers !== undefined && !options.length;
    return <section aria-label={t("Fix verification")} className="flex flex-col gap-2">
        {v && <div className="flex flex-col gap-1 text-sm">
            <p className="m-0 whitespace-pre-wrap break-words">{verificationText(v, t, language)}</p>
            {v.summary && <p className="m-0 whitespace-pre-wrap break-words">{v.summary}</p>}
            {v.fixUrl && <a href={v.fixUrl} target="_blank" rel="noopener noreferrer" className="self-start underline underline-offset-2">{t("Open fix link")}</a>}
        </div>}
        {proof?.evidenceView}
        {responses && !formOpen && <div className="flex flex-wrap gap-2">
            {p?.respond && <>
                <Button size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => send('confirm')}>{t("Confirm fix")}</Button>
                <Button variant="outline" size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => send('reject')}>{t("Still needs work")}</Button>
            </>}
            {p?.override && <>
                <Button variant="outline" size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => send('confirm', true)}>{t("Confirm fix as admin")}</Button>
                <Button variant="outline" size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => send('reject', true)}>{t("Still needs work as admin")}</Button>
            </>}
            {p?.cancel && <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={pending} onClick={() => send('cancel')}>{t("Cancel request")}</Button>}
        </div>}
        {formOpen && <form aria-label={t("Request verification")} className="rounded-lg border p-3" onSubmit={event => { event.preventDefault(); send('request'); }}>
            <FieldGroup>
                <Field><FieldLabel htmlFor={`${id}-summary`}>{t("Fix summary")}</FieldLabel><Textarea ref={first} id={`${id}-summary`} maxLength={500} value={summary} onChange={e => setSummary(e.target.value)} disabled={pending} /></Field>
                {proof ? proof.requestTarget : <Field><FieldLabel htmlFor={`${id}-link`}>{t("Fix link (optional)")}</FieldLabel><Input className="pointer-coarse:min-h-11" id={`${id}-link`} type="url" maxLength={2048} value={fixUrl} onChange={e => setFixUrl(e.target.value)} disabled={pending} /></Field>}
                {noReviewers ? (
                    <Field>
                        <FieldTitle>{t("Reviewer")}</FieldTitle>
                        <FieldDescription id={`${id}-reviewer-help`}>
                            {t("Nobody else can check this fix yet. The reviewer needs access to this project, and it can't be you.")}
                        </FieldDescription>
                        {!proof && <InviteButton projectId={projectId} variant="outline" className="self-start pointer-coarse:min-h-11" />}
                    </Field>
                ) : (
                    <Field><FieldLabel htmlFor={`${id}-reviewer`}>{t("Reviewer")}</FieldLabel>
                        <Select items={options} value={reviewer} onValueChange={value => setReviewer(value ?? '')} disabled={pending || reviewers === undefined}>
                            <SelectTrigger className="pointer-coarse:min-h-11" id={`${id}-reviewer`} aria-describedby={`${id}-reviewer-help`}>
                                <SelectValue placeholder={reviewers === undefined ? t("Loading reviewers…") : t("Choose a reviewer")} />
                            </SelectTrigger>
                            <SelectContent><SelectGroup>{options.map(option => <SelectItem className="pointer-coarse:min-h-11" key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
                        </Select>
                        <FieldDescription id={`${id}-reviewer-help`}>{t("The reviewer confirms the fix or says it still needs work.")}{!reviewer && t(" Choose one to send the request.")}</FieldDescription>
                    </Field>
                )}
                <div className="flex gap-2">
                    <Button type="submit" disabled={pending || !reviewer || Boolean(proof && !proof.evidence)} aria-describedby={reviewer ? undefined : `${id}-reviewer-help`} className="pointer-coarse:min-h-11">{t("Request verification")}</Button>
                    <Button variant="ghost" className="pointer-coarse:min-h-11" disabled={pending} onClick={close}>{t("Cancel")}</Button>
                </div>
            </FieldGroup>
        </form>}
        {pending && <p role="status" className="m-0 flex items-center gap-2 text-sm"><Spinner />{t("Saving verification…")}</p>}
        {error && <p role="alert" className="m-0 text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="m-0 text-sm text-muted-foreground">{notice}</p>}
    </section>;
}
