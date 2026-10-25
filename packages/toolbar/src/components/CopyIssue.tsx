import { useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import type { FeedbackExport } from '../feedbackContext';
import { apiRequest, required, currentReviewerRevision } from '../hooks/api';
import { commentUrl } from '../hooks/useComments';
import { useAnnounce } from './Announcer';
import { CommentsErrorMessage } from './CommentsErrorMessage';

/** Fetch on every explicit copy, so removed/private items cannot be exported from a stale cache. */
export function CopyIssue({ commentId }: { commentId: string }) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<unknown>();
    const [manual, setManual] = useState<string>();
    const [copied, setCopied] = useState(false);
    const announce = useAnnounce();
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
    return <div className="flex min-w-0 flex-col gap-2">
        <Button variant="plain" size="xs" className="self-start pointer-coarse:min-h-11" disabled={pending} onClick={copy}>
            {pending ? 'Preparing issue…' : 'Copy issue'}
        </Button>
        {copied && <p role="status" className="m-0 text-xs text-muted-foreground">Issue copied.</p>}
        <CommentsErrorMessage error={error} />
        {manual !== undefined && <>
            <p role="alert" className="m-0 text-xs text-muted-foreground">Couldn&rsquo;t copy. Select the Markdown below and copy it.</p>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Issue Markdown
                <textarea readOnly value={manual} onFocus={event => event.currentTarget.select()}
                    className="max-h-64 min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <Button variant="plain" size="xs" className="self-start" onClick={() => setManual(undefined)}>Close copy text</Button>
        </>}
    </div>;
}
