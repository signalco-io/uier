'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Badge } from '@/src/components/ui/badge';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import { Field, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Textarea } from '@/src/components/ui/textarea';
import { useAppI18n } from '@/src/lib/i18n/client';
import { approvalOutcomeLabels, approvalReviewerLimit, type ApprovalDecision, type ApprovalReview, type ApprovalState } from '@/src/lib/proofs/approvals/model';
import type { ReviewerInput } from '@/src/lib/proofs/approvals/schema';
import { proofViewerPath } from '@/src/lib/proofs/model';
import { proofErrorMessage, proofFetch, proofWrite, ProofRequestError } from './client';
import { ProofSelect } from './ProofSelect';

type Round = NonNullable<ApprovalReview['round']>;
type Options = {
    members: { id: string; name: string }[];
    shares: { id: string; scope: { kind: string }; createdAt: string }[];
    assignments: ReviewerInput[];
};
type Draft = { key: string; value: ReviewerInput };

function dateLabel(language: string, value: string) {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function localDate(value?: string | null) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const stateLabels = { paused: 'Round paused', closed: 'Round closed' } as const;

export function ProofApprovalPanel({ endpoint, projectId, assetId, versionId, number }: {
    endpoint: string; projectId: string; assetId: string; versionId: string; number: number | null;
}) {
    const { t, language } = useAppI18n();
    const controlId = useId();
    const path = `${endpoint}/approvals`;
    const versionQuery = new URLSearchParams({ version: versionId });
    const [review, setReview] = useState<ApprovalReview>();
    const [expanded, setExpanded] = useState<boolean>();
    const [editor, setEditor] = useState(false);
    const [loading, setLoading] = useState(true);
    const [attempt, setAttempt] = useState(0);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const statusRef = useRef<HTMLParagraphElement>(null);
    const inFlight = useRef(false);
    const intent = useRef<{ key: string; fingerprint: string }>(null);
    const panelRef = useRef<HTMLElement>(null);
    const emailLink = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('approval');
    const open = expanded ?? Boolean(review?.reviewerId || review?.canRequestLink || emailLink);
    useEffect(() => {
        if (emailLink) panelRef.current?.scrollIntoView({ block: 'nearest' });
    }, [emailLink]);
    const reviewPath = `${path}?version=${encodeURIComponent(versionId)}`;

    useEffect(() => {
        const controller = new AbortController();
        proofFetch<ApprovalReview>(reviewPath, { signal: controller.signal }).then(
            result => { if (!controller.signal.aborted) { setReview(result); setLoading(false); } },
            error => { if (!controller.signal.aborted) { setError(proofErrorMessage(error)); setLoading(false); } }
        );
        return () => controller.abort();
    }, [reviewPath, attempt]);

    async function run(action: () => Promise<void>, message: string) {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        setError('');
        setConfirmation('');
        try {
            await action();
            setConfirmation(message);
            requestAnimationFrame(() => statusRef.current?.focus());
        } catch (error) {
            setError(proofErrorMessage(error));
            if (error instanceof ProofRequestError && error.status === 409) {
                setEditor(false);
                setAttempt(value => value + 1);
            }
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    }

    function save(method: 'POST' | 'PATCH', data: object, message: string, mode?: string) {
        return run(async () => {
            const fingerprint = JSON.stringify([method, mode, data]);
            if (intent.current?.fingerprint !== fingerprint) intent.current = { key: crypto.randomUUID(), fingerprint };
            const result = await proofWrite<ApprovalReview>(mode ? `${path}?mode=${mode}` : path, method, {
                ...data, versionId, requestId: intent.current.key
            });
            intent.current = null;
            setReview(result);
            setEditor(false);
        }, message);
    }

    const round = review?.round;
    const reviewer = round?.reviewers.find(reviewer => reviewer.id === review?.reviewerId);
    const history = round ? [...round.history].reverse() : [];

    function changeState(state: ApprovalState) {
        if (!round) return;
        void save('PATCH', { revision: round.revision, deadline: round.deadline, state },
            state === 'paused' ? 'Round paused' : state === 'closed' ? 'Round closed' : 'Round resumed');
    }

    return <section ref={panelRef} aria-label={t('Approvals')} className="grid min-w-0 gap-3 rounded-xl border bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" className="h-auto px-2 py-2" aria-expanded={open} aria-controls={controlId}
                onClick={() => setExpanded(!open)}>{t('Approvals')}</Button>
            {round && <Badge variant="secondary">{t(approvalOutcomeLabels[round.outcome])}</Badge>}
        </div>
        <div hidden={!open} id={controlId} className="min-w-0 space-y-3">
            {loading && <p role="status" className="m-0 text-sm text-muted-foreground">{t('Loading approvals…')}</p>}
            {error && <div className="grid justify-items-start gap-2">
                <p role="alert" className="m-0 text-sm text-destructive">{t(error)}</p>
                {!review && <Button size="sm" variant="outline" onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1); }}>{t('Retry')}</Button>}
            </div>}
            {review && <>
                <h2 className="m-0 text-sm font-medium">{t('Approval for version {number}', { number: number ?? '–' })}</h2>
                {review.currentVersionId !== versionId &&
                    <Link href={proofViewerPath(projectId, assetId, review.currentVersionId)} className="block text-sm underline underline-offset-4">{t('Open current version')}</Link>}
                {!round && <p className="m-0 text-sm text-muted-foreground">{t('No approval round for this version.')}</p>}
                {round && <>
                    {round.state !== 'open' && <p className="m-0 text-sm">{t(stateLabels[round.state])}</p>}
                    {round.deadline && <p className="m-0 text-sm text-muted-foreground">
                        {t(round.overdue ? 'Overdue since {date}' : 'Due {date}', { date: dateLabel(language, round.deadline) })}
                    </p>}
                    <ul className="m-0 list-none divide-y rounded-lg border p-0">
                        {round.reviewers.map(item => <li key={item.id} className="grid gap-1 p-2 text-sm">
                            <p className="m-0 break-words font-medium">{item.name}</p>
                            <p className="m-0 text-muted-foreground">{t(item.required ? 'Required reviewer' : 'Optional reviewer')} · {t(approvalOutcomeLabels[item.decision?.decision ?? 'pending'])}</p>
                            {item.decision?.explanation && <p className="m-0 whitespace-pre-wrap break-words">{item.decision.explanation}</p>}
                        </li>)}
                    </ul>
                    {reviewer && <DecisionForm key={`${reviewer.id}:${reviewer.decision?.revision ?? 0}`} pending={pending} previous={reviewer.decision?.decision}
                        onDecision={(decision, explanation) => void save('POST', {
                            decision, explanation, revision: round.revision, decisionRevision: reviewer.decision?.revision ?? 0
                        }, 'Approval decision saved.', 'decision')} />}
                    {review.canRequestLink && <form className="grid gap-2" onSubmit={event => {
                        event.preventDefault();
                        const email = String(new FormData(event.currentTarget).get('email'));
                        void run(() => proofWrite(`${path}?mode=recover`, 'POST', { email, versionId }), 'If you were assigned, a verification link will be sent to your email.');
                    }}>
                        <Field>
                            <FieldLabel htmlFor={`${controlId}-email`}>{t('Reviewer email')}</FieldLabel>
                            <Input id={`${controlId}-email`} type="email" name="email" required />
                        </Field>
                        <Button type="submit" size="sm" variant="outline" className="justify-self-start" disabled={pending}>{t('Email me a verification link')}</Button>
                    </form>}
                    {history.length > 0 && <details className="text-sm">
                        <summary className="cursor-pointer font-medium">{t('Decision history')}</summary>
                        <ol className="m-0 mt-2 list-none divide-y rounded-lg border p-0">
                            {history.map(entry => <li className="break-words p-2" key={`${entry.reviewerId}:${entry.at}:${entry.revision}`}>
                                <p className="m-0">{entry.reviewerName} · {t(approvalOutcomeLabels[entry.decision])}</p>
                                <time className="text-muted-foreground" dateTime={entry.at}>{dateLabel(language, entry.at)}</time>
                                {entry.explanation && <p className="m-0 whitespace-pre-wrap">{entry.explanation}</p>}
                            </li>)}
                        </ol>
                    </details>}
                </>}
                <div className="flex flex-wrap gap-2">
                    {review.canManage && round?.state !== 'closed' && <>
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => { setError(''); setEditor(true); }}>
                            {t(round ? 'Edit round' : 'Start approval round')}
                        </Button>
                        {round && <>
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => changeState(round.state === 'open' ? 'paused' : 'open')}>
                                {t(round.state === 'open' ? 'Pause round' : 'Resume round')}
                            </Button>
                        </>}
                    </>}
                    <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`${path}?${versionQuery}&mode=export`} download>
                        {t('Download review record')}
                    </a>
                </div>
            </>}
            <p role="status" tabIndex={-1} ref={statusRef} className="m-0 text-sm focus:outline-none">{t(confirmation)}</p>
        </div>
        {editor && <RoundEditor path={`${reviewPath}&mode=options`} round={round} pending={pending} error={error} onClose={() => setEditor(false)}
            onSave={(reviewers, deadline, state) => {
                if (!round) void save('POST', { reviewers, deadline }, 'Approval round started.');
                else void save('PATCH', state === 'closed' ? { revision: round.revision, deadline: round.deadline, state }
                    : { revision: round.revision, reviewers, deadline, state }, state === 'closed' ? 'Round closed' : 'Approval round saved.');
            }} />}
    </section>;
}

function DecisionForm({ pending, previous, onDecision }: {
    pending: boolean; previous?: ApprovalDecision; onDecision: (decision: ApprovalDecision, explanation?: string) => void;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const [requestChanges, setRequestChanges] = useState(false);
    return <div className="grid gap-2">
        {requestChanges ? <form className="grid gap-2" onSubmit={event => {
            event.preventDefault();
            onDecision('changes-requested', String(new FormData(event.currentTarget).get('reason')));
        }}>
            <Field>
                <FieldLabel htmlFor={id}>{t('What needs to change?')}</FieldLabel>
                <Textarea id={id} name="reason" maxLength={2000} required autoFocus />
            </Field>
            <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={pending}>{t('Submit change request')}</Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setRequestChanges(false)}>{t('Cancel')}</Button>
            </div>
        </form> : <div className="flex flex-wrap gap-2">
            {previous !== 'approved' && <Button size="sm" disabled={pending} onClick={() => onDecision('approved')}>{t('Approve version')}</Button>}
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setRequestChanges(true)}>{t('Request changes')}</Button>
        </div>}
    </div>;
}

function emptyReviewer(kind: ReviewerInput['kind'], required = true): ReviewerInput {
    return kind === 'member' ? { kind, userId: '', required } : { kind, name: '', email: '', shareId: '', required };
}

function RoundEditor({ path, round, pending, error, onClose, onSave }: {
    path: string; round?: Round | null; pending: boolean; error: string; onClose: () => void;
    onSave: (reviewers: ReviewerInput[], deadline: string | null, state: ApprovalState) => void;
}) {
    const { t, language } = useAppI18n();
    const id = useId();
    const [options, setOptions] = useState<Options>();
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [loadError, setLoadError] = useState('');
    const [closing, setClosing] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        proofFetch<Options>(path, { signal: controller.signal }).then(result => {
            if (!controller.signal.aborted) {
                setOptions(result);
                setDrafts((result.assignments.length ? result.assignments : [emptyReviewer('member')])
                    .map(value => ({ key: crypto.randomUUID(), value: value.kind === 'member'
                        ? { kind: 'member', userId: value.userId, required: value.required }
                        : { kind: 'external', name: value.name, email: value.email, shareId: value.shareId, required: value.required } })));
            }
        }, error => { if (!controller.signal.aborted) setLoadError(proofErrorMessage(error)); });
        return () => controller.abort();
    }, [path, retry]);

    function update(key: string, value: ReviewerInput) {
        setDrafts(items => items.map(item => item.key === key ? { key, value } : item));
    }

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const date = String(new FormData(event.currentTarget).get('deadline') ?? '');
        const deadline = date === localDate(round?.deadline) ? round?.deadline ?? null : date ? new Date(date).toISOString() : null;
        onSave(drafts.map(item => item.value), deadline, closing ? 'closed' : round?.state ?? 'open');
    }

    return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" showCloseButton={!pending}>
            <DialogHeader>
                <DialogTitle>{t(round ? 'Edit approval round' : 'Start approval round')}</DialogTitle>
                <DialogDescription>{t('Choose who must approve this version. Optional reviewers can also leave a decision.')}</DialogDescription>
            </DialogHeader>
            {error && <p role="alert" className="m-0 text-sm text-destructive">{t(error)}</p>}
            {loadError ? <div className="grid gap-2">
                <p role="alert" className="m-0 text-sm text-destructive">{t(loadError)}</p>
                <Button size="sm" variant="outline" onClick={() => { setLoadError(''); setRetry(value => value + 1); }}>{t('Retry')}</Button>
            </div> : !options ? <p className="m-0 text-sm text-muted-foreground" role="status">{t('Loading reviewers…')}</p>
                : <form className="grid gap-3" onSubmit={submit}>
                    {closing ? <p className="m-0 text-sm">{t('Close this round and keep all recorded decisions?')}</p> : <>
                        {drafts.map(({ key, value }, index) => <fieldset className="grid min-w-0 gap-2 rounded-lg border p-3" key={key}>
                            <legend className="px-1 text-sm font-medium">{t('Reviewer {number}', { number: index + 1 })}</legend>
                            <ProofSelect label={t('Reviewer type')} value={value.kind}
                                items={[{ value: 'member', label: t('Project member') }, { value: 'external', label: t('External reviewer') }]}
                                onChange={kind => update(key, emptyReviewer(kind === 'member' ? 'member' : 'external', value.required))} />
                            {value.kind === 'member' ? <ProofSelect label={t('Project member')} value={value.userId} onChange={userId => update(key, { ...value, userId })}
                                items={[{ value: '', label: t('Choose a project member') }, ...options.members.map(({ id, name }) => ({ value: id, label: name })),
                                    ...(value.userId && !options.members.some(member => member.id === value.userId) ? [{ value: value.userId, label: t('Member unavailable') }] : [])]} />
                                : <>
                                    <Field>
                                        <FieldLabel htmlFor={`${id}-name-${key}`}>{t('Reviewer name')}</FieldLabel>
                                        <Input id={`${id}-name-${key}`} value={value.name} maxLength={100} required
                                            onChange={event => update(key, { ...value, name: event.target.value })} />
                                    </Field>
                                    <Field>
                                        <FieldLabel htmlFor={`${id}-email-${key}`}>{t('Reviewer email')}</FieldLabel>
                                        <Input id={`${id}-email-${key}`} type="email" value={value.email} maxLength={254} required
                                            onChange={event => update(key, { ...value, email: event.target.value })} />
                                    </Field>
                                    <ProofSelect label={t('Review link')} value={value.shareId} onChange={shareId => update(key, { ...value, shareId })}
                                        items={[{ value: '', label: t('Choose a review link') }, ...options.shares.map(share => ({ value: share.id,
                                            label: t(share.scope.kind === 'asset' ? 'File link from {date}' : 'Collection link from {date}', { date: dateLabel(language, share.createdAt) }) })),
                                            ...(value.shareId && !options.shares.some(share => share.id === value.shareId)
                                                ? [{ value: value.shareId, label: t('Review link unavailable') }] : [])]} />
                                    {!options.shares.length && <p className="m-0 text-sm text-muted-foreground">{t('Create a review link in the file library to invite an external reviewer.')}</p>}
                                </>}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <FieldLabel className="gap-2"><Checkbox checked={value.required} onCheckedChange={required => update(key, { ...value, required })} />
                                    {t('Required reviewer')}</FieldLabel>
                                {drafts.length > 1 && <Button size="sm" variant="ghost" aria-label={t('Remove reviewer {number}', { number: index + 1 })}
                                    onClick={() => setDrafts(items => items.filter(item => item.key !== key))}>{t('Remove')}</Button>}
                            </div>
                        </fieldset>)}
                        <Button size="sm" variant="outline" className="justify-self-start" disabled={drafts.length >= approvalReviewerLimit || pending}
                            onClick={() => setDrafts(items => [...items, { key: crypto.randomUUID(), value: emptyReviewer('member') }])}>{t('Add reviewer')}</Button>
                        <Field>
                            <FieldLabel htmlFor={`${id}-deadline`}>{t('Approval deadline')}</FieldLabel>
                            <Input id={`${id}-deadline`} type="datetime-local" name="deadline" defaultValue={localDate(round?.deadline)} className="min-w-0" />
                        </Field>
                    </>}
                    <div className="flex flex-wrap gap-2">
                        <Button type="submit" disabled={pending || (!closing && (!drafts.some(({ value }) => value.required) ||
                            drafts.some(({ value }) => value.kind === 'member' ? !value.userId : !value.shareId)))}>{t(closing ? 'Confirm close round' : round ? 'Save round' : 'Start round')}</Button>
                        {round && !closing && <Button variant="outline" disabled={pending} onClick={() => setClosing(true)}>{t('Close round')}</Button>}
                        <Button variant="outline" disabled={pending} onClick={closing ? () => setClosing(false) : onClose}>{t('Cancel')}</Button>
                    </div>
                </form>}
        </DialogContent>
    </Dialog>;
}
