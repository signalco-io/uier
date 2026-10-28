'use client';

import { useState } from 'react';
import { ClipboardCopyIcon, XIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { copyIssueAction } from './actions';

export function useCopyIssue(projectId: string, commentId: string) {
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState('');
    const [failed, setFailed] = useState(false);
    const [manual, setManual] = useState<string>();
    const copy = async () => {
        setPending(true); setMessage(''); setManual(undefined); setFailed(false);
        try {
            const result = await copyIssueAction(projectId, commentId);
            if (!result?.ok) {
                setFailed(true); setMessage(result?.error ?? 'Couldn’t prepare the issue. Try again.');
                return;
            }
            try {
                await navigator.clipboard.writeText(result.data.markdown);
                setMessage('Issue copied.');
            } catch {
                setFailed(true); setMessage('Couldn’t copy. Select the Markdown below and copy it.');
                setManual(result.data.markdown);
            }
        } catch { setFailed(true); setMessage('Couldn’t prepare the issue. Check your connection and try again.'); }
        finally { setPending(false); }
    };
    return { pending, message, failed, manual, copy, close: () => { setManual(undefined); setMessage(''); } };
}

export function CopyIssueButton({ state }: { state: ReturnType<typeof useCopyIssue> }) {
    return (
        <Button size="icon-sm" variant="ghost" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            title="Copy issue" aria-label="Copy issue" aria-busy={state.pending}
            disabled={state.pending} onClick={state.copy}>
            {state.pending ? <Spinner data-icon="inline-start" /> : <ClipboardCopyIcon aria-hidden="true" data-icon="inline-start" />}
        </Button>
    );
}

export function CopyIssueResult({ state }: { state: ReturnType<typeof useCopyIssue> }) {
    const { message, failed, manual } = state;
    if (!message && manual === undefined) return null;
    return <div className="flex min-w-0 flex-col gap-2">
        {message && <p role={failed ? 'alert' : 'status'} className="m-0 text-xs text-muted-foreground">{message}</p>}
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
