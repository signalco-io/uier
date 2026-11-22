import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Copy, Down, Up, Warning } from '@signalco/ui-icons';
import { proposalCss, type ChangeProposal } from '../changeProposal';
import { useLayoutVersion } from '../hooks/useLayoutVersion';
import { useProposalSession } from '../hooks/useProposalSession';
import { useMessages } from '../i18n';
import { readProposalTarget } from '../proposalPreview';
import { proposalDrift, proposalMatchesTarget, proposalSessionActive, revealProposalTarget } from '../proposalSession';
import { useAnnounce } from './Announcer';
import { useReattach } from './CommentAnchorDetails';
import { IconTooltip } from './IconTooltip';
import { ProposalChanges, proposalChangeCount } from './ProposalChanges';
import { TextChanges } from './TextChanges';
import type { CommentItem, CommentItemPosition } from './@types/Comments';

export { rewriteProposal, rewriteWithoutProposal, savedProposal } from '../rewriteProposal';

/**
 * Where a thread's preview switch goes instead of its message: the phone sheet's title bar (`CommentBubble`), so it
 * stays in reach while the thread scrolls.
 */
export const ProposalSwitchSlot = createContext<HTMLElement | null>(null);

const isEditable = (target: EventTarget | null) => target instanceof HTMLElement
    && (target.isContentEditable || /^(?:input|textarea|select)$/i.test(target.tagName));

/**
 * Original and Proposed: which one the page shows. Holding \ (outside a text field) shows the original until it is
 * released, so the two compare without moving the pointer.
 */
export function ProposalSwitch({ session, position, disabled = false }: { session: ReturnType<typeof useProposalSession>; position: CommentItemPosition; disabled?: boolean }) {
    const t = useMessages().proposal;
    const proposed = session.result === 'proposed';
    const group = useRef<HTMLDivElement>(null);
    const holding = useRef(false);
    useLayoutEffect(() => {
        const sheet = group.current?.closest<HTMLDialogElement>('dialog[data-uier-proposal-sheet]');
        if (sheet?.open && !disabled && session.result !== 'stale') revealProposalTarget(position, sheet);
    }, [position, proposed, disabled, session.result]);
    const { showOriginal, showProposed } = session;
    useEffect(() => {
        if (disabled) return;
        const down = (event: KeyboardEvent) => {
            if (event.key !== '\\' || event.repeat || isEditable(event.composedPath()[0] ?? null) || !proposed) return;
            holding.current = true;
            showOriginal();
        };
        const up = (event: KeyboardEvent) => {
            if (event.key !== '\\' || !holding.current) return;
            holding.current = false;
            showProposed();
        };
        window.addEventListener('keydown', down, true);
        window.addEventListener('keyup', up, true);
        return () => {
            window.removeEventListener('keydown', down, true);
            window.removeEventListener('keyup', up, true);
        };
    }, [disabled, proposed, showOriginal, showProposed]);
    const segment = 'h-6 rounded-full px-2.5 text-xs font-medium pointer-coarse:min-h-11 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-[0_0_0_1px_hsl(var(--border))] text-muted-foreground';
    return <div ref={group} className="flex min-w-0 flex-wrap items-center gap-2">
        <div role="group" aria-label={t.preview} data-uier-proposal-switch=""
            className="inline-flex shrink-0 items-center rounded-full border bg-muted p-0.5">
            <IconTooltip label={t.holdOriginal} shortcut="\">
                <Button size="xs" variant="plain" type="button" className={segment} aria-keyshortcuts="\"
                    data-uier-proposal-side="original" aria-pressed={!proposed} onClick={showOriginal}>{t.original}</Button>
            </IconTooltip>
            <Button size="xs" variant="plain" type="button" className={segment}
                data-uier-proposal-side="proposed" aria-pressed={proposed} disabled={disabled || session.result === 'stale'}
                onClick={showProposed}>{t.proposed}</Button>
        </div>
        {session.result === 'pending' && <span role="status" className="text-xs text-muted-foreground">{t.preparing}</span>}
    </div>;
}

export function SavedProposal({ comment, proposal, interactive }: { comment: CommentItem; proposal: ChangeProposal; interactive: boolean }) {
    const t = useMessages();
    const id = useId();
    const anchor = useReattach(comment);
    const slot = useContext(ProposalSwitchSlot);
    const [detailsOpen, setDetailsOpen] = useState<boolean>();
    const onPage = anchor.samePage && anchor.originalSource;
    const previewAllowed = interactive && onPage && !comment.pending;
    useLayoutVersion(previewAllowed);
    const session = useProposalSession(comment.position, proposal, previewAllowed);
    // Another open thread can be previewing the same target. Check only unmodified content.
    const target = previewAllowed && !proposalSessionActive() ? readProposalTarget(comment.position, proposal.text?.original) : undefined;
    const stale = session.result === 'stale' || (target !== undefined && !proposalMatchesTarget(proposal, target));
    // A stale suggestion opens its values, which still copy when the page can't show them
    const showDetails = detailsOpen ?? stale;
    const rewrite = comment.kind === 'rewrite';
    const textOnly = rewrite && proposal.text && !Object.keys(proposal.styles).length;
    const previewSwitch = previewAllowed && <ProposalSwitch session={session} position={comment.position} disabled={stale} />;

    return <section aria-label={rewrite ? t.feedbackTypes.rewrite : t.proposal.suggestion}
        data-uier-saved-proposal="" className="grid min-w-0 gap-2 rounded-lg border px-2.5 py-2">
        {(!rewrite || (previewSwitch && !slot)) && <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            {!rewrite && <p className="m-0 text-sm font-medium">
                {t.proposal.suggestion}
                <span className="font-normal text-muted-foreground"> · {t.proposal.changeCount(proposalChangeCount(proposal))}</span>
            </p>}
            {!slot && previewSwitch}
        </div>}
        {slot && previewSwitch && createPortal(previewSwitch, slot)}
        {stale && <StaleNotice comment={comment} proposal={proposal} anchor={anchor} />}
        {textOnly ? <TextChanges original={proposal.text!.original} proposed={proposal.text!.proposed} /> : <ProposalChanges proposal={proposal} />}
        <Button type="button" size="xs" variant="plain" className="justify-self-start text-muted-foreground pointer-coarse:min-h-11" data-uier-proposal-details=""
            aria-expanded={showDetails} aria-controls={showDetails ? id : undefined}
            endDecorator={showDetails ? <Up size={14} aria-hidden="true" /> : <Down size={14} aria-hidden="true" />}
            onClick={() => setDetailsOpen(!showDetails)}>{t.proposal.values}</Button>
        {showDetails && <div id={id} data-uier-proposal-values="" className="grid gap-2">
            <ProposalValues proposal={proposal} side="original" />
            <ProposalValues proposal={proposal} side="proposed" />
        </div>}
    </section>;
}

/** The page drifted from the saved originals: what changed, and Reattach where the reviewer may move the comment */
function StaleNotice({ comment, proposal, anchor }: { comment: CommentItem; proposal: ChangeProposal; anchor: ReturnType<typeof useReattach> }) {
    const t = useMessages();
    // Another thread's preview would read as the page's values: list what drifted only while none is shown
    const drift = proposalSessionActive() ? [] : proposalDrift(proposal, readProposalTarget(comment.position, proposal.text?.original));
    return <div className="grid gap-1.5 rounded-md border border-[hsl(var(--brand-warning)/0.5)] bg-[hsl(var(--brand-warning)/0.08)] px-2.5 py-2 text-xs">
        <p role="status" className="m-0 flex items-start gap-1.5 font-medium text-foreground">
            <Warning size={14} aria-hidden="true" className="mt-px shrink-0 text-[hsl(var(--brand-warning))]" />
            {t.proposal.stale}
        </p>
        {drift?.length !== 0 && <ul className="m-0 grid list-none gap-0.5 p-0 pl-5 text-secondary-foreground" data-uier-proposal-drift="">
            {drift === null
                ? <li>{t.proposal.targetGone}</li>
                : drift.map(item => item.key === 'text'
                    ? <li key="text">{t.proposal.driftText}</li>
                    : <li key={item.key}>{item.current === undefined
                        ? t.proposal.driftMissing(t.proposal.properties[item.key], item.saved)
                        : t.proposal.drift(t.proposal.properties[item.key], item.current, item.saved)}</li>)}
        </ul>}
        {anchor.available && <Button size="xs" variant="outlined" className="justify-self-start pointer-coarse:min-h-11"
            onClick={anchor.request}>{t.thread.reattach}</Button>}
    </div>;
}

function ProposalValues({ proposal, side }: { proposal: ChangeProposal; side: 'original' | 'proposed' }) {
    const t = useMessages().proposal;
    const css = proposalCss(proposal, side);
    return <div className="min-w-0 space-y-1 rounded-md bg-muted px-2 py-1.5" data-uier-proposal-values-side={side}>
        <p className="m-0 text-xs font-medium">{t[side]}</p>
        {proposal.text && <CopyableValue text={proposal.text[side]} label={t.copyText(t[side])} />}
        {css && <CopyableValue text={css} label={t.copyCss(t[side])} code />}
    </div>;
}

/** A value with its Copy icon beside it; a refused clipboard opens the value selected, to copy by hand */
function CopyableValue({ text, label, code }: { text: string; label: string; code?: boolean }) {
    const t = useMessages();
    const announce = useAnnounce();
    const [manual, setManual] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            announce(t.proposal.copied);
        } catch { setManual(true); }
    };
    return <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-1">
            <pre className={cx('m-0 max-h-40 min-w-0 flex-1 select-text overflow-y-auto whitespace-pre-wrap break-words py-1 text-xs', code ? 'font-mono' : 'font-sans')}>
                {text || t.proposal.empty}
            </pre>
            <IconTooltip label={label}>
                <IconButton type="button" size="xs" variant="plain" aria-label={label}
                    className="size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11" onClick={() => void copy()}>
                    <Copy size={14} aria-hidden="true" />
                </IconButton>
            </IconTooltip>
        </div>
        {manual && <textarea autoFocus readOnly aria-label={label} value={text} onFocus={event => event.currentTarget.select()}
            className="w-full rounded-md border border-input bg-background p-2 text-xs" />}
    </div>;
}

