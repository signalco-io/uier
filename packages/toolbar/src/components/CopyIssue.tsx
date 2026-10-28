import { useEffect, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Copy } from '@signalco/ui-icons';
import type { FeedbackExport } from '../feedbackContext';
import { apiRequest, required, currentReviewerRevision } from '../hooks/api';
import { commentUrl } from '../hooks/useComments';
import { useAnnounce } from './Announcer';
import { CommentsErrorMessage } from './CommentsErrorMessage';

/** Fetch on every explicit copy, so removed/private items cannot be exported from a stale cache. */
export function useCopyIssue(commentId: string) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<unknown>();
    const [manual, setManual] = useState<string>();
    const [copied, setCopied] = useState(false);
    const announce = useAnnounce();
    useEffect(() => {
        if (!copied) return;
        const timeout = window.setTimeout(() => setCopied(false), 2000);
        return () => window.clearTimeout(timeout);
    }, [copied]);
    const copy = async () => {
        setPending(true); setError(undefined); setManual(undefined); setCopied(false);
        const revision = currentReviewerRevision();
        try {
            const packet = required(await apiRequest<FeedbackExport>(`${commentUrl(commentId)}/context`));
            if (revision !== currentReviewerRevision()) return;
            try {
                await navigator.clipboard.writeText(packet.markdown);
                setCopied(true); announce('Issue copied');
            } catch {
                setManual(packet.markdown);
            }
        } catch (error) { setError(error); }
        finally { setPending(false); }
    };
    return { pending, error, manual, copied, copy, close: () => setManual(undefined) };
}

export function CopyIssueButton({ state, className }: { state: ReturnType<typeof useCopyIssue>; className?: string }) {
    return <span className="relative inline-flex shrink-0">
        <IconButton size="xs" variant="plain" className={className}
            title="Copy issue" aria-label="Copy issue" aria-busy={state.pending}
            disabled={state.pending} onClick={state.copy}>
            <Copy size={16} />
        </IconButton>
        {/* The shared announcer reports success to screen readers once. */}
        {state.copied && <span aria-hidden="true"
            className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm animate-in fade-in-0 slide-in-from-top-2 duration-150 ease-out">
            Issue copied.
        </span>}
    </span>;
}

export function CopyIssueResult({ state }: { state: ReturnType<typeof useCopyIssue> }) {
    const { error, manual } = state;
    if (!error && manual === undefined) return null;
    return <div className="flex min-w-0 flex-col gap-2">
        <CommentsErrorMessage error={error} />
        {manual !== undefined && <>
            <p role="alert" className="m-0 text-xs text-muted-foreground">Couldn&rsquo;t copy. Select the Markdown below and copy it.</p>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Issue Markdown
                <textarea readOnly value={manual} onFocus={event => event.currentTarget.select()}
                    className="max-h-64 min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <Button variant="plain" size="xs" className="self-start" onClick={state.close}>Close copy text</Button>
        </>}
    </div>;
}
