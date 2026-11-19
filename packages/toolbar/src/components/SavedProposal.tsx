import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { hasVisibleReplacement, isChangeProposal, proposalCss, type ChangeProposal } from '../changeProposal';
import { useLayoutVersion } from '../hooks/useLayoutVersion';
import { useProposalSession } from '../hooks/useProposalSession';
import { useMessages } from '../i18n';
import { markdownPlainText, type MarkdownMention } from '../markdown';
import { readProposalTarget } from '../proposalPreview';
import { proposalMatchesTarget, proposalSessionActive, revealProposalTarget } from '../proposalSession';
import { useAnnounce } from './Announcer';
import { useReattach } from './CommentAnchorDetails';
import type { CommentItem, CommentItemPosition } from './@types/Comments';

export function rewriteProposal(original: string | undefined, markdown: string, mentions?: readonly MarkdownMention[]) {
    if (original === undefined || !markdown.trim()) return undefined;
    const proposed = markdownPlainText(markdown, mentions);
    if (!hasVisibleReplacement(proposed)) return undefined;
    const proposal = { text: { original, proposed }, styles: {} };
    return isChangeProposal(proposal) ? proposal : undefined;
}

export function savedProposal(comment: CommentItem | undefined) {
    const first = comment?.thread.items[0];
    if (!comment || !first || first.deleted) return undefined;
    if (isChangeProposal(comment.proposal)) return comment.proposal;
    if (comment.kind !== 'rewrite') return undefined;
    const selected = comment.position.type === 'text' ? comment.position.text : undefined;
    const original = first.quotedText && selected?.trim() !== first.quotedText ? first.quotedText : selected ?? first.quotedText;
    return rewriteProposal(original, first.text, first.mentions);
}

export function ProposalSwitch({ session, position, disabled = false }: { session: ReturnType<typeof useProposalSession>; position: CommentItemPosition; disabled?: boolean }) {
    const t = useMessages().proposal;
    const proposed = session.result === 'proposed';
    const group = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const sheet = group.current?.closest<HTMLDialogElement>('dialog[data-uier-proposal-sheet]');
        if (sheet?.open) revealProposalTarget(position, sheet);
    }, [position, proposed]);
    return <div ref={group} role="group" aria-label={t.preview} data-uier-proposal-switch="" className="flex flex-wrap items-center gap-1">
        <Button size="xs" variant={proposed ? 'plain' : 'outlined'} type="button" className="pointer-coarse:min-h-11"
            data-uier-proposal-side="original" aria-pressed={!proposed} onClick={session.showOriginal}>{t.original}</Button>
        <Button size="xs" variant={proposed ? 'outlined' : 'plain'} type="button" className="pointer-coarse:min-h-11"
            data-uier-proposal-side="proposed" aria-pressed={proposed} disabled={disabled || session.result === 'stale'}
            onClick={session.showProposed}>{t.proposed}</Button>
        {session.result === 'pending' && <span role="status" className="text-xs text-muted-foreground">{t.preparing}</span>}
    </div>;
}

export function SavedProposal({ comment, proposal, interactive }: { comment: CommentItem; proposal: ChangeProposal; interactive: boolean }) {
    const t = useMessages();
    const id = useId();
    const anchor = useReattach(comment);
    const [detailsOpen, setDetailsOpen] = useState<boolean>();
    const onPage = anchor.samePage && anchor.originalSource;
    const previewAllowed = interactive && onPage && !comment.pending;
    useLayoutVersion(previewAllowed);
    const session = useProposalSession(comment.position, proposal, previewAllowed);
    // Another open thread can be previewing the same target. Check only unmodified content.
    const stale = session.result === 'stale' || (previewAllowed && !proposalSessionActive()
        && !proposalMatchesTarget(proposal, readProposalTarget(comment.position, proposal.text?.original)));
    const showDetails = detailsOpen ?? (stale || !interactive && comment.kind !== 'rewrite');

    return <section aria-label={comment.kind === 'rewrite' ? t.feedbackTypes.rewrite : t.proposal.suggestion}
        data-uier-saved-proposal="" className="grid min-w-0 gap-1 rounded-lg border px-2.5 py-2">
        {comment.kind !== 'rewrite' && <p className="m-0 text-sm font-medium">{t.proposal.suggestion}</p>}
        {previewAllowed && <ProposalSwitch session={session} position={comment.position} disabled={stale} />}
        {stale && <div className="text-xs text-muted-foreground">
            <p role="status" className="m-0">{t.proposal.stale}</p>
            {anchor.available && <Button size="xs" variant="plain" className="pointer-coarse:min-h-11"
                onClick={anchor.request}>{t.thread.reattach}</Button>}
        </div>}
        <Button type="button" size="xs" variant="plain" className="justify-self-start pointer-coarse:min-h-11" data-uier-proposal-details=""
            aria-expanded={showDetails} aria-controls={showDetails ? id : undefined}
            onClick={() => setDetailsOpen(!showDetails)}>{t.proposal.values}</Button>
        {showDetails && <div id={id} data-uier-proposal-values="" className="grid gap-2">
            <ProposalValues proposal={proposal} side="original" />
            <ProposalValues proposal={proposal} side="proposed" />
        </div>}
    </section>;
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
        <pre className={`m-0 max-h-40 select-text overflow-y-auto whitespace-pre-wrap break-words text-xs ${code ? 'font-mono' : 'font-sans'}`}>
            {text || t.proposal.empty}
        </pre>
        <Button type="button" size="xs" variant="plain" className="pointer-coarse:min-h-11" onClick={() => void copy()}>{label}</Button>
        {manual && <textarea autoFocus readOnly aria-label={label} value={text} onFocus={event => event.currentTarget.select()}
            className="w-full rounded-md border border-input bg-background p-2 text-xs" />}
    </div>;
}
