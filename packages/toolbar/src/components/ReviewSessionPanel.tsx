import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Input } from '@signalco/ui-primitives/Input';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Delete, ListTodo } from '@signalco/ui-icons';
import { newLocalId } from '../hooks/useComments';
import { useMessages } from '../i18n';
import { useProjectViewer } from '../project/ProjectGate';
import { loadReviewSession, reviewSessionDetailKey, useReviewSessionCommand, type ReviewSessionComment, type ReviewSessionView } from '../project/reviewSessions';
import { toolbarSurface } from '../toolbarReview';
import { destructiveTextClassName, floatingShadowClassName, inputFocusRingClassName } from './@types/Comments';
import { useAnnounce } from './Announcer';
import { CommentsErrorMessage } from './CommentsErrorMessage';
import { useToolbarPortalContainer } from './CommentsBootstrapperContext';
import { IconTooltip } from './IconTooltip';
import { useInkContainer } from './InkScope';

// 16 px text on small screens keeps iOS from zooming the page into the field; 44 px tall for touch
const fieldClassName = `min-w-0 [&>input]:text-base sm:[&>input]:text-sm pointer-coarse:[&>input]:min-h-11 ${inputFocusRingClassName}`;
const touchClassName = 'pointer-coarse:min-h-11';

export function ReviewSessionPanel({ session, onOpenComment, onFinished }: {
    session: ReviewSessionView;
    onOpenComment: (comment: ReviewSessionComment) => void;
    onFinished: () => void;
}) {
    const { reviewSessions: t, common, composer } = useMessages();
    const announce = useAnnounce();
    const { draftScope } = useProjectViewer();
    const container = useToolbarPortalContainer(useInkContainer());
    const id = useId();
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState(session.title ?? '');
    const [summary, setSummary] = useState(session.summary ?? '');
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const discardRef = useRef<HTMLButtonElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const command = useReviewSessionCommand();
    const edit = useReviewSessionCommand();
    const lastEdit = useRef({ title: session.title ?? '', summary: session.summary ?? '' });
    const attempt = useRef<{ title: string; summary: string; key: string }>(undefined);
    const detail = useQuery({
        queryKey: reviewSessionDetailKey(session.id, draftScope),
        queryFn: () => loadReviewSession(session.id),
        enabled: open,
        staleTime: 0
    });
    const pending = detail.data?.draftId === session.draftId ? detail.data?.pending : session.pending;
    const busy = command.isPending;
    const sending = busy && command.variables?.action === 'submit';
    const draftId = session.draftId;
    const empty = session.pendingCount === 0;
    const canSend = session.state === 'open' && !empty && !busy;
    const editing = { title: title.trim(), summary: summary.trim() };
    const name = session.number ? t.number(session.number) : t.label;

    const saveDetails = () => {
        if (!draftId || busy || session.state !== 'open' || editing.title === lastEdit.current.title && editing.summary === lastEdit.current.summary) return;
        lastEdit.current = editing;
        edit.mutate({ action: 'edit', id: session.id, draftId, ...editing }, {
            onError: () => { lastEdit.current = { title: session.title ?? '', summary: session.summary ?? '' }; }
        });
    };

    const send = async () => {
        if (!draftId || !canSend) return;
        if (attempt.current?.title !== editing.title || attempt.current.summary !== editing.summary) attempt.current = { ...editing, key: newLocalId() };
        try {
            await command.mutateAsync({ action: 'submit', id: session.id, draftId, revision: session.revision, idempotencyKey: attempt.current.key, ...editing });
            announce(t.sent);
            onFinished();
        } catch { /* The panel keeps the draft and shows the failure. */ }
    };

    const discard = async () => {
        if (!draftId || busy) return;
        try {
            await command.mutateAsync({ action: 'discard', id: session.id, draftId });
            announce(empty ? t.ended : t.discarded);
            onFinished();
        } catch { /* The panel keeps the draft and shows the failure. */ }
    };

    // Like deleting a message: the question takes the place of the buttons and the focus moves to its answer
    const askDiscard = (next: boolean) => {
        setConfirmDiscard(next);
        window.setTimeout(() => (next ? confirmRef : discardRef).current?.focus(), 0);
    };

    return (
        <Popper container={container} open={open} onOpenChange={next => { setOpen(next); if (!next) setConfirmDiscard(false); }}
            side="top" sideOffset={8} aria-label={t.label}
            onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
            // The heading, not the first field: on a phone a focused field would open the keyboard
            {...{ onOpenAutoFocus: (event: Event) => { event.preventDefault(); headingRef.current?.focus(); } }}
            {...toolbarSurface('uier-review-session', `z-[60] flex max-h-[var(--radix-popover-content-available-height)] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-y-auto overscroll-contain rounded-xl p-4 ${floatingShadowClassName}`)}
            trigger={<Button variant="outlined" size="sm" className={`rounded-full bg-background text-foreground tabular-nums shadow-(--brand-shadow-review) ${touchClassName}`}
                data-uier-review-marker="" aria-description={name} startDecorator={<ListTodo aria-hidden="true" size={16} />}>
                {t.pending(session.pendingCount)}
            </Button>}>
            <div className="flex flex-col gap-3">
                <header className="flex flex-col gap-1">
                    <h2 ref={headingRef} tabIndex={-1} className="m-0 text-sm font-semibold focus:outline-none">{name}</h2>
                    <p className="m-0 text-xs text-muted-foreground">{t.heldHelp}</p>
                </header>
                {empty
                    ? session.state === 'open' && <p className="m-0 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{t.empty}</p>
                    : pending ? <ul aria-label={t.pending(session.pendingCount)} className="m-0 max-h-36 list-none overflow-y-auto overscroll-contain rounded-lg border p-1">
                        {pending.map(comment => <li key={comment.id}>
                            <Button fullWidth size="sm" variant="plain" className={`min-w-0 justify-start gap-2 text-start ${touchClassName}`}
                                onClick={() => { setOpen(false); onOpenComment(comment); }}>
                                {comment.number !== undefined && <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">#{comment.number}</span>}
                                <span className="truncate">{comment.text || comment.path}</span>
                            </Button>
                        </li>)}
                    </ul> : detail.error ? <CommentsErrorMessage error={detail.error} /> : <p role="status" className="m-0 text-xs text-muted-foreground">{t.loading}</p>}
                {session.state === 'open' && <div className="flex flex-col gap-3">
                    <Input fullWidth label={t.title} value={title} maxLength={120} autoComplete="off" className={fieldClassName}
                        onChange={event => setTitle(event.target.value)} onBlur={saveDetails} />
                    <div className="flex flex-col gap-1">
                        <label htmlFor={`${id}-summary`} className="text-sm font-medium">{t.summary}</label>
                        <textarea id={`${id}-summary`} rows={3} value={summary} maxLength={1000} onChange={event => setSummary(event.target.value)} onBlur={saveDetails}
                            className={`min-h-11 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none sm:text-sm ${inputFocusRingClassName}`} />
                    </div>
                </div>}
                <CommentsErrorMessage error={command.error ?? edit.error} />
                {confirmDiscard ? <div className="flex flex-col gap-2">
                    <p id={`${id}-discard`} role="status" className="m-0 text-sm text-foreground">{t.discardHelp(session.pendingCount)}</p>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="plain" size="sm" className={touchClassName} disabled={busy} onClick={() => askDiscard(false)}>{common.cancel}</Button>
                        <Button ref={confirmRef} variant="outlined" size="sm" aria-describedby={`${id}-discard`} disabled={busy}
                            className={`${empty ? '' : destructiveTextClassName} ${touchClassName}`} onClick={() => void discard()}>
                            {empty ? t.discardEmpty : t.discard}
                        </Button>
                    </div>
                </div> : <div className="flex flex-wrap justify-end gap-2">
                    {session.state === 'discarding' || empty
                        ? <Button ref={discardRef} variant="plain" size="sm" className={touchClassName} disabled={busy}
                            onClick={() => session.state === 'discarding' ? void discard() : askDiscard(true)}>
                            {session.state === 'discarding' ? t.finishDiscard : t.discardEmpty}
                        </Button>
                        : <IconTooltip label={t.discard}>
                            <IconButton ref={discardRef} type="button" variant="plain" size="sm" aria-label={t.discard}
                                className="size-8 pointer-coarse:size-11" disabled={busy} onClick={() => askDiscard(true)}>
                                <Delete size={20} aria-hidden="true" />
                            </IconButton>
                        </IconTooltip>}
                    {session.state === 'open' && <Button size="sm" className={touchClassName} disabled={!canSend} onClick={() => void send()}>
                        {sending ? composer.sending : t.send}
                    </Button>}
                </div>}
            </div>
        </Popper>
    );
}
