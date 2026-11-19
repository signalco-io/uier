import type { CommentItemPosition } from './components/@types/Comments';
import type { ChangeProposal } from './changeProposal';
import { readProposalTarget, startProposalPreview } from './proposalPreview';
import { getCommentPlacement, resolveAnchorElement } from './hooks/useCommentItemRects';

type PreviewResult = 'pending' | 'proposed' | 'original' | 'stale';
type Session = { start: () => void; stop: (result: PreviewResult) => void };

let current: Session | undefined;
let captures = 0;

export function stopProposalSession() {
    current?.stop('original');
}

export function proposalSessionActive() {
    return Boolean(current);
}

/** Leave a usable view of the target above a phone sheet, without moving targets already in view. */
export function revealProposalTarget(position: CommentItemPosition, sheet: HTMLDialogElement) {
    const target = resolveAnchorElement(position);
    const available = sheet.getBoundingClientRect().top;
    if (!target || available < 48) return;
    const current = () => position.type === 'text'
        ? getCommentPlacement(position).rects[0] ?? target.getBoundingClientRect()
        : target.getBoundingClientRect();
    const margin = 8;
    const box = current();
    if (box.top >= margin && box.bottom <= available - margin) return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const next = current();
    const top = Math.max(margin, (available - next.height) / 2);
    window.scrollBy({ top: next.top - top, behavior: 'instant' });
}

/** Capture reads the real page across several frames. A newly requested preview waits for it. */
export function holdProposalSessions() {
    stopProposalSession();
    captures++;
    return () => {
        captures--;
        if (captures === 0) current?.start();
    };
}

export function proposalMatchesTarget(proposal: ChangeProposal, target: ReturnType<typeof readProposalTarget>) {
    return Boolean(target
        && (!proposal.text || proposal.text.original === target.text)
        && Object.entries(proposal.styles).every(([property, change]) =>
            target.styles[property as keyof typeof target.styles] === change.original));
}

/** Owns a single page preview, including one waiting for an original screenshot. */
export function showProposalSession(position: CommentItemPosition, proposal: ChangeProposal, notify: (result: PreviewResult) => void) {
    stopProposalSession();
    let restore: (() => void) | null = null;
    const leave = () => session.stop('original');
    const session: Session = {
        start: () => {
            if (current !== session) return;
            if (proposalMatchesTarget(proposal, readProposalTarget(position, proposal.text?.original))) {
                restore = startProposalPreview(position, proposal, () => session.stop('stale'));
                if (restore && current === session) {
                    notify('proposed');
                    return;
                }
                // The engine can invalidate during startup.
                if (current !== session) { restore?.(); return; }
            }
            session.stop('stale');
        },
        stop: result => {
            if (current !== session) return;
            current = undefined;
            window.removeEventListener('pagehide', leave, true);
            restore?.();
            notify(result);
        }
    };
    current = session;
    window.addEventListener('pagehide', leave, true);
    if (captures) notify('pending');
    else session.start();
    return leave;
}
