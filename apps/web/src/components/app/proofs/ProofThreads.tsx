'use client';

import { useEffect, useEffectEvent, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { Check, ChevronRight, MapPin } from 'lucide-react';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Textarea } from '@/src/components/ui/textarea';
import { useAppI18n } from '@/src/lib/i18n/client';
import { workflowStatusLabel } from '@/src/lib/app/statusWorkflow';
import { proofApiPath, proofViewerPath } from '@/src/lib/proofs/model';
import type { ProofAnchor, ProofPendingPage, ProofThread, ProofThreadLocation, ProofThreadPage, ProofVerificationEvidence } from '@/src/lib/proofs/threadModel';
import { MessageMarkdown } from '../comments/MessageMarkdown';
import { VerificationControl } from '../comments/VerificationControl';
import { proofFetch, ProofRequestError, proofWrite } from './client';

export type ProofThreadsProps = {
    projectId: string;
    assetId: string;
    versionId: string;
    currentVersionId: string | null;
    threadId?: string;
    draftAnchor?: ProofAnchor;
    onThreadSelect?: (threadId: string) => void;
    onJump?: (location: ProofThreadLocation) => void;
    onEvidence?: (evidence: ProofVerificationEvidence, side: 'before' | 'after') => void;
    onRequestTarget?: () => void;
    onThreadsChange?: (threads: ProofThread[]) => void;
};

const generalAnchor: ProofAnchor = { kind: 'general' };
const noPending: ProofPendingPage = { threads: [], next: null, count: 0 };
type ThreadResult = { thread: ProofThread };

function params(version: string, cursor?: string | null) {
    return '?' + new URLSearchParams({ version, ...(cursor ? { before: cursor } : {}) });
}

function writeKey(ref: { current?: { payload: string; key: string } }, value: unknown) {
    const payload = JSON.stringify(value);
    if (ref.current?.payload !== payload) ref.current = { payload, key: crypto.randomUUID() };
    return ref.current.key;
}

export function ProofThreads({ projectId, assetId, versionId, currentVersionId, threadId, draftAnchor, onThreadSelect, onJump, onEvidence, onRequestTarget, onThreadsChange }: ProofThreadsProps) {
    const { t } = useAppI18n();
    const base = `${proofApiPath(projectId)}/assets/${encodeURIComponent(assetId)}`;
    const heading = useRef<HTMLHeadingElement>(null);
    const detailHeading = useRef<HTMLHeadingElement>(null);
    const readTarget = useRef<HTMLDivElement>(null);
    const id = useId();
    const [open, setOpen] = useState(threadId);
    const [detail, setDetail] = useState<ProofThread>();
    const [listed, setListed] = useState<{ key: string; page: ProofThreadPage }>();
    const [queue, setQueue] = useState<{ key: string; page: ProofPendingPage }>();
    const [otherPending, setOtherPending] = useState<{ key: string; thread: ProofThread }>();
    const [refresh, setRefresh] = useState(0);
    const [name, setName] = useState('');
    const [text, setText] = useState('');
    const [privateNote, setPrivateNote] = useState(false);
    const [reply, setReply] = useState('');
    const [statusId, setStatusId] = useState<string>();
    const [formOpen, setFormOpen] = useState(false);
    const [error, setError] = useState<string>();
    const [loadError, setLoadError] = useState<string>();
    const [notice, setNotice] = useState<string>();
    const [busy, start] = useTransition();
    const [focusAfter, setFocusAfter] = useState<string>();
    const createAttempt = useRef<{ payload: string; key: string }>(undefined);
    const actionAttempt = useRef<{ payload: string; key: string }>(undefined);
    const query = params(versionId);
    const key = base + query;
    const page = listed?.key === key ? listed.page : undefined;
    const pending = queue?.key === key ? queue.page : noPending;
    const selected = detail?.id === open ? detail : undefined;
    const threadEndpoint = (thread: string) => `${base}/threads/${encodeURIComponent(thread)}`;
    const notifyThreads = useEffectEvent((threads: ProofThread[]) => onThreadsChange?.(threads));
    const describe = (reason: unknown) => reason instanceof ProofRequestError ? t(reason.message) : t('The request could not be completed.');

    useEffect(() => {
        setOpen(threadId);
        setFormOpen(false);
        setReply('');
        setError(undefined);
    }, [threadId, base]);

    useEffect(() => {
        const controller = new AbortController();
        const signal = controller.signal;
        setLoadError(undefined);
        Promise.all([
            proofFetch<ProofThreadPage>(`${base}/threads${query}`, { signal }),
            proofFetch<ProofPendingPage>(`${base}/verification${query}`, { signal })
        ]).then(([threads, verification]) => {
            if (signal.aborted) return;
            setListed({ key, page: threads });
            setQueue({ key, page: verification });
        }, reason => {
            if (!signal.aborted) {
                setLoadError(describe(reason));
                setListed(undefined);
                setQueue(undefined);
            }
        });
        return () => controller.abort();
    }, [base, key, query, refresh, t]);

    useEffect(() => { notifyThreads(page?.threads ?? []); }, [page]);

    useEffect(() => {
        if (!page?.canComment || queue?.key !== key || queue.page.count > 0) return;
        const controller = new AbortController();
        void proofFetch<ProofPendingPage>(`${base}/verification${query}&scope=asset&limit=1`, { signal: controller.signal })
            .then(result => {
                if (!controller.signal.aborted) setOtherPending(result.threads[0] ? { key, thread: result.threads[0] } : undefined);
            }, () => { if (!controller.signal.aborted) setOtherPending(undefined); });
        return () => controller.abort();
    }, [base, page?.canComment, key, query, queue]);

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        proofFetch<ThreadResult>(`${base}/threads/${encodeURIComponent(open)}${query}`, { signal: controller.signal })
            .then(({ thread }) => { if (!controller.signal.aborted) setDetail(thread); }, reason => {
                if (!controller.signal.aborted) {
                    setDetail(undefined);
                    setError(describe(reason));
                }
            });
        return () => controller.abort();
    }, [base, open, query, refresh, t]);

    useEffect(() => {
        if (!selected || focusAfter !== selected.id) return;
        detailHeading.current?.focus();
        setFocusAfter(undefined);
    }, [focusAfter, selected]);

    useEffect(() => {
        if (!selected?.activity?.unread || !readTarget.current) return;
        const { id: thread, activity } = selected;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const observer = new IntersectionObserver(entries => {
            clearTimeout(timer);
            if (entries.some(entry => entry.isIntersecting) && document.visibilityState === 'visible') {
                timer = setTimeout(() => {
                    if (document.visibilityState !== 'visible') return;
                    void proofWrite(`${base}/threads/${encodeURIComponent(thread)}${query}`, 'PATCH', { operation: 'read', sequence: activity.sequence }).catch(() => undefined);
                }, 800);
            }
        });
        observer.observe(readTarget.current);
        return () => { clearTimeout(timer); observer.disconnect(); };
    }, [base, query, selected?.id, selected?.activity?.sequence, selected?.activity?.unread]);

    const select = (thread: ProofThread, location = thread.location) => {
        if (thread.id !== open) {
            setFormOpen(false);
            setStatusId(undefined);
            setReply('');
            setError(undefined);
            actionAttempt.current = undefined;
        }
        setOpen(thread.id);
        setNotice(undefined);
        setDetail(thread);
        setFocusAfter(thread.id);
        onThreadSelect?.(thread.id);
        onJump?.(location);
    };

    const reload = () => setRefresh(value => value + 1);

    useEffect(() => {
        const refreshOnFocus = () => setRefresh(value => value + 1);
        window.addEventListener('focus', refreshOnFocus);
        return () => window.removeEventListener('focus', refreshOnFocus);
    }, []);

    function submitMessage(event: FormEvent, target?: ProofThread) {
        event.preventDefault();
        const payload = target ? { text: reply, ...(page?.guest ? { authorName: name } : {}) }
            : { text, ...(page?.guest ? { authorName: name } : {}), location: { versionId, anchor: draftAnchor ?? generalAnchor }, ...(page?.canMakePrivate && privateNote ? { private: true } : {}) };
        if (!payload.text.trim() || (page?.guest && !name.trim()) || busy) return;
        const attempt = target ? actionAttempt : createAttempt;
        start(async () => {
            setError(undefined);
            try {
                const endpoint = target ? `${threadEndpoint(target.id)}/replies${query}` : `${base}/threads`;
                const { thread } = await proofWrite<ThreadResult>(endpoint, 'POST', { ...payload, idempotencyKey: writeKey(attempt, { endpoint, payload }) });
                attempt.current = undefined;
                if (target) { setReply(''); setDetail(thread); }
                else { setText(''); setPrivateNote(false); select(thread); }
                reload();
            } catch (reason) { setError(describe(reason)); }
        });
    }

    function patch(operation: Record<string, unknown>, keyed = true) {
        if (!selected || busy) return;
        start(async () => {
            setError(undefined);
            try {
                const { thread } = await proofWrite<ThreadResult>(threadEndpoint(selected.id) + query, 'PATCH', {
                    ...operation, ...(keyed ? { idempotencyKey: writeKey(actionAttempt, { threadId: selected.id, operation }) } : {})
                });
                actionAttempt.current = undefined;
                setDetail(thread);
                reload();
            } catch (reason) {
                setError(describe(reason));
                if (reason instanceof ProofRequestError && reason.status === 409) reload();
            }
        });
    }

    function loadMore() {
        if (!page?.next || busy) return;
        start(async () => {
            try {
                const next = await proofFetch<ProofThreadPage>(`${base}/threads${params(versionId, page.next)}`);
                setListed(previous => previous?.key === key
                    ? { key, page: { ...next, threads: [...previous.page.threads, ...next.threads.filter(thread => !previous.page.threads.some(item => item.id === thread.id))] } }
                    : previous);
            } catch (reason) { setError(describe(reason)); }
        });
    }

    const firstPending = pending.threads.find(thread => thread.id !== open);
    const evidence = selected?.verification?.evidence;
    const revisedAnchor = draftAnchor ?? selected?.target.relocations?.find(location => location.versionId === versionId)?.anchor
        ?? (selected?.target.source.anchor.kind === 'general' ? generalAnchor : undefined);
    const requestEvidence = selected && revisedAnchor && versionId !== selected.target.source.versionId
        ? { assetId, before: selected.target.source, after: { versionId, anchor: revisedAnchor } }
        : undefined;
    const jumpToEvidence = (side: 'before' | 'after') => {
        if (!evidence) return;
        if (onEvidence) onEvidence(evidence, side);
        else onJump?.(evidence[side]);
    };
    const afterVersion = selected?.evidenceLinks?.after.number;
    const latestVersion = selected?.currentVersionId ?? currentVersionId;
    const verificationControlComment = selected && {
        ...selected, verificationPermissions: {
            ...selected.verificationPermissions,
            respond: Boolean(selected.evidenceLinks && selected.verificationPermissions.respond),
            override: Boolean(selected.evidenceLinks && selected.verificationPermissions.override)
        }
    };
    const completedLabel = t('No more changes to check on this version.');
    const evidenceView = evidence && <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{afterVersion ? t('Fix check for version {number}', { number: afterVersion }) : t('Requested version')}</p>
        <div className="flex flex-wrap gap-2">
            {(['before', 'after'] as const).map(side => {
                const label = side === 'before' ? t('Before') : t('After');
                return onEvidence || onJump
                    ? <Button key={side} variant="outline" className="pointer-coarse:min-h-11" onClick={() => jumpToEvidence(side)}>{label}</Button>
                    : <a key={side} className={buttonVariants({ variant: 'outline' })} href={selected?.evidenceLinks?.[side].href}>{label}</a>;
            })}
            {latestVersion && latestVersion !== evidence.after.versionId && <a className={buttonVariants({ variant: 'ghost' })}
                href={proofViewerPath(projectId, assetId, latestVersion)}>{t('Open latest version')}</a>}
        </div>
    </div>;

    async function saveVerification(payload: Record<string, unknown>, action: 'request' | 'confirm' | 'reject' | 'cancel') {
        if (!selected) return { ok: false as const, error: t('This thread could not be loaded.') };
        let saved: ProofThread;
        try {
            saved = (await proofWrite<ThreadResult>(`${threadEndpoint(selected.id)}/verification`, 'POST', payload)).thread;
        } catch (reason) {
            if (reason instanceof ProofRequestError && reason.status === 409) reload();
            return { ok: false as const, error: describe(reason) };
        }
        setDetail(saved);
        reload();
        setFormOpen(false);
        if ((action === 'confirm' || action === 'reject') && selected.verificationPermissions.respond && evidence) {
            try {
                const next = await proofFetch<ProofPendingPage>(`${base}/verification${params(evidence.after.versionId)}`);
                const thread = next.threads[0];
                if (thread) select(thread, thread.verification?.evidence?.after ?? thread.location);
                else {
                    setNotice(completedLabel);
                    heading.current?.focus();
                }
            } catch (reason) {
                setError(describe(reason));
                heading.current?.focus();
            }
        } else detailHeading.current?.focus();
        return { ok: true as const };
    }

    const nameField = page?.guest && page.canComment && <Field>
        <FieldLabel htmlFor={`${id}-name`}>{t('Your name')}</FieldLabel>
        <Input className="pointer-coarse:min-h-11" required id={`${id}-name`} autoComplete="name" maxLength={80} value={name} onChange={event => setName(event.target.value)} />
    </Field>;

    return <section aria-labelledby={`${id}-threads`} className="flex min-w-0 flex-col gap-4">
        <h2 ref={heading} tabIndex={-1} id={`${id}-threads`} className="text-base font-semibold">{t('Comments')}</h2>
        {pending.count > 0 && <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm tabular-nums">{t('Changes ready for you to check ({count})', { count: pending.count })}</p>
            {firstPending && <Button variant="outline" className="pointer-coarse:min-h-11"
                onClick={() => select(firstPending, firstPending.verification?.evidence?.after ?? firstPending.location)}>
                {t('Next pending check')}<ChevronRight data-icon="inline-end" />
            </Button>}
        </div>}
        {pending.count === 0 && otherPending?.key === key && <Button variant="outline" className="self-start pointer-coarse:min-h-11"
            onClick={() => select(otherPending.thread, otherPending.thread.verification?.evidence?.after ?? otherPending.thread.location)}>
            {t('Resume pending checks')}<ChevronRight data-icon="inline-end" />
        </Button>}
        {notice && <p role="status" className="flex items-center gap-2 text-sm"><Check className="size-4" />{notice}</p>}
        {loadError && <div className="flex flex-wrap gap-2"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button onClick={reload} variant="outline">{t('Try again')}</Button></div>}
        {!page && !loadError && <p role="status" className="text-sm text-muted-foreground">{t('Loading comments')}</p>}
        {!!page?.threads.length && <ul className="divide-y rounded-lg border">
            {page.threads.map(thread => <li key={thread.id}>
                <Button variant={thread.id === open ? 'secondary' : 'ghost'} className="min-h-11 w-full justify-start rounded-none"
                    onClick={() => select(thread)} aria-current={thread.id === open ? 'true' : undefined}>
                    <MapPin data-icon="inline-start" />
                    {thread.number && <span className="tabular-nums">#{thread.number}</span>}
                    <span className="min-w-0 truncate">{thread.thread.items[0] && !('deleted' in thread.thread.items[0]) ? thread.thread.items[0].text : t('Deleted feedback')}</span>
                </Button>
            </li>)}
        </ul>}
        {page?.next && <Button variant="outline" onClick={loadMore} disabled={busy}>{t('Load more')}</Button>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {open && !selected && !error && <p role="status" className="text-sm text-muted-foreground">{t('Loading thread')}</p>}
        {nameField}
        {selected && <div ref={readTarget} className="flex min-w-0 flex-col gap-3 rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-2">
                <h3 ref={detailHeading} tabIndex={-1} className="font-semibold">{t('Thread')}{selected.number ? ` #${selected.number}` : ''}</h3>
                <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={selected.href}
                    onClick={onJump ? event => { event.preventDefault(); onJump(selected.target.source); } : undefined}>{t('Original location')}</a>
            </div>
            <ul className="grid gap-3">
                {selected.thread.items.map(item => <li key={item.id} className="min-w-0 text-sm">
                    {'deleted' in item ? <p className="text-muted-foreground">{t('Deleted message')}</p> : <>
                        <p className="font-medium">{item.author.name}</p><MessageMarkdown text={item.text} />
                    </>}
                </li>)}
            </ul>
            <div className="flex flex-wrap items-start gap-2">
                {selected.permissions.resolve && !selected.archivedAt && <Select value={selected.statusId} items={(page?.statuses ?? []).map(status => ({ value: status.id, label: workflowStatusLabel(status, t) }))}
                    disabled={busy} onValueChange={status => {
                        if (!status) return;
                        const item = page?.statuses.find(option => option.id === status);
                        if (item?.category === 'ready') {
                            if (selected.verificationPermissions.request) { setStatusId(status); setFormOpen(true); }
                        } else patch({ operation: 'status', statusId: status });
                    }}>
                    <SelectTrigger aria-label={t('Status')} className="pointer-coarse:min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{(page?.statuses ?? []).map(status => <SelectItem key={status.id} value={status.id}
                        disabled={status.category === 'ready' && !selected.verificationPermissions.request}>{workflowStatusLabel(status, t)}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>}
                {selected.permissions.resolve && selected.archivedAt && <Button variant="outline" className="pointer-coarse:min-h-11"
                    disabled={busy} onClick={() => patch({ operation: 'archive', archived: false })}>{t('Restore')}</Button>}
                {selected.permissions.assign && selected.participants && <Select multiple disabled={busy} value={selected.assignees?.flatMap(person => person.id ? [person.id] : []) ?? []}
                    items={selected.participants.map(person => ({ value: person.id, label: person.name }))}
                    onValueChange={assigneeIds => patch({ operation: 'assignment', assigneeIds })}>
                    <SelectTrigger aria-label={t('Assignees')} className="pointer-coarse:min-h-11"><SelectValue placeholder={t('Unassigned')} /></SelectTrigger>
                    <SelectContent><SelectGroup>{selected.participants.map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>}
                {selected.verificationPermissions.request && <Button variant="outline" className="pointer-coarse:min-h-11" disabled={formOpen} onClick={() => { setStatusId(undefined); setFormOpen(true); }}>{t('Request verification')}</Button>}
                {selected.permissions.assign && draftAnchor && versionId !== selected.target.source.versionId && <Button variant="outline" className="pointer-coarse:min-h-11"
                    disabled={busy} onClick={() => patch({ operation: 'relocate', expectedRevision: selected.revision, location: { versionId, anchor: draftAnchor } }, false)}>{t('Save revised location')}</Button>}
            </div>
            {selected.permissions.makePrivate && <Field orientation="horizontal">
                <Checkbox id={`${id}-thread-private`} checked={selected.private} disabled={busy}
                    onCheckedChange={checked => patch({ operation: 'private', private: checked === true }, false)} />
                <FieldLabel htmlFor={`${id}-thread-private`}>{t('Make private')}</FieldLabel>
            </Field>}
            <VerificationControl key={selected.id} projectId={projectId} userId={selected.verificationPermissions.selfId ?? ''}
                comment={verificationControlComment!} formOpen={formOpen} onFormOpenChange={setFormOpen} returnFocus={detailHeading} statusId={statusId} proof={{
                    participants: selected.participants ?? [], evidence: requestEvidence, targetVersionId: evidence?.after.versionId, evidenceView, save: saveVerification,
                    requestTarget: <Field><FieldTitle>{t('Revised location')}</FieldTitle>
                        <FieldDescription>{requestEvidence ? (revisedAnchor?.kind === 'general' ? t('Using the whole version.') : t('Using the selected location.')) : t('Choose a location on a newer version.')}</FieldDescription>
                        {onRequestTarget && <Button variant="outline" className="self-start pointer-coarse:min-h-11" onClick={onRequestTarget}>{t('Choose location')}</Button>}
                    </Field>
                }} />
            {page?.canComment && <form aria-label={t('Reply')} onSubmit={event => submitMessage(event, selected)}>
                <FieldGroup>
                    <Field><FieldLabel htmlFor={`${id}-reply`}>{t('Reply')}</FieldLabel>
                        <Textarea required id={`${id}-reply`} maxLength={1000} value={reply} onChange={event => setReply(event.target.value)} />
                    </Field>
                    <Button type="submit" className="self-start pointer-coarse:min-h-11" disabled={busy || !reply.trim() || (page.guest && !name.trim())}>{t('Reply')}</Button>
                </FieldGroup>
            </form>}
        </div>}
        {page?.canComment && <form aria-label={t('Add comment')} onSubmit={event => submitMessage(event)}>
            <FieldGroup>
                <Field><FieldLabel htmlFor={`${id}-comment`}>{t('Add comment')}</FieldLabel>
                    <Textarea required id={`${id}-comment`} maxLength={1000} value={text} onChange={event => setText(event.target.value)} />
                    {draftAnchor && <FieldDescription>{t('Using the selected location.')}</FieldDescription>}
                </Field>
                {page.canMakePrivate && <Field orientation="horizontal">
                    <Checkbox id={`${id}-private`} checked={privateNote} onCheckedChange={checked => setPrivateNote(checked === true)} />
                    <FieldLabel htmlFor={`${id}-private`}>{t('Make private')}</FieldLabel>
                </Field>}
                <Button type="submit" className="self-start pointer-coarse:min-h-11" disabled={busy || !text.trim() || (page.guest && !name.trim())}>{t('Add comment')}</Button>
            </FieldGroup>
        </form>}
    </section>;
}
