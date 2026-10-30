'use client';

import { useEffect, useState } from 'react';
import { CopyIcon, XIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { copyIssueAction } from './actions';
import { ThreadAction } from './ThreadAction';

export function useCopyIssue(projectId: string, commentId: string) {
    const [pending, setPending] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');
    const [manual, setManual] = useState<string>();
    useEffect(() => {
        if (!copied) return;
        const timeout = window.setTimeout(() => setCopied(false), 2000);
        return () => window.clearTimeout(timeout);
    }, [copied]);
    const copy = async () => {
        setPending(true); setCopied(false); setError(''); setManual(undefined);
        try {
            const result = await copyIssueAction(projectId, commentId);
            if (!result?.ok) {
                setError(result?.error ?? 'Couldn’t prepare the issue. Try again.');
                return;
            }
            try {
                await navigator.clipboard.writeText(result.data.markdown);
                setCopied(true);
            } catch {
                setError('Couldn’t copy. Select the Markdown below and copy it.');
                setManual(result.data.markdown);
            }
        } catch { setError('Couldn’t prepare the issue. Check your connection and try again.'); }
        finally { setPending(false); }
    };
    return { pending, copied, error, manual, copy, close: () => { setManual(undefined); setError(''); } };
}

/** The toolbar's Copy issue: the same copy icon, next to Copy link; success shows under it */
export function CopyIssueButton({ state }: { state: ReturnType<typeof useCopyIssue> }) {
    return <>
        <ThreadAction label="Copy issue" notice={state.copied ? 'Issue copied.' : undefined}
            busy={state.pending} disabled={state.pending} onClick={state.copy}>
            {state.pending ? <Spinner /> : <CopyIcon aria-hidden="true" />}
        </ThreadAction>
        <span role="status" className="sr-only">{state.copied ? 'Issue copied.' : ''}</span>
    </>;
}

export function CopyIssueResult({ state }: { state: ReturnType<typeof useCopyIssue> }) {
    const { error, manual } = state;
    if (!error && manual === undefined) return null;
    return <div className="flex min-w-0 flex-col gap-2">
        {error && <p role="alert" className="m-0 text-xs text-muted-foreground">{error}</p>}
        {manual !== undefined && <>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Issue Markdown
                <textarea readOnly value={manual} onFocus={event => event.currentTarget.select()}
                    className="max-h-64 min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <Button size="xs" variant="ghost" className="self-start pointer-coarse:min-h-11" onClick={state.close}>
                <XIcon aria-hidden="true" data-icon="inline-start" />
                Close copy text
            </Button>
        </>}
    </div>;
}
