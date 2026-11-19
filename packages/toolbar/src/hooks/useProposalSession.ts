import { useLayoutEffect, useState } from 'react';
import type { ChangeProposal } from '../changeProposal';
import type { CommentItemPosition } from '../components/@types/Comments';
import { showProposalSession } from '../proposalSession';

export function useProposalSession(position: CommentItemPosition, proposal: ChangeProposal | undefined, enabled: boolean, initiallyRequested = false) {
    const [requested, setRequested] = useState(initiallyRequested);
    const [result, setResult] = useState<'original' | 'pending' | 'proposed' | 'stale'>('original');
    useLayoutEffect(() => {
        if (!requested || !proposal || !enabled) {
            setResult('original');
            return;
        }
        let watching = true;
        const stop = showProposalSession(position, proposal, next => {
            if (!watching) return;
            setResult(next);
            if (next === 'original') setRequested(false);
        });
        return () => {
            watching = false;
            stop();
        };
    }, [position, proposal, enabled, requested]);
    return { result, showOriginal: () => setRequested(false), showProposed: () => setRequested(true) };
}
