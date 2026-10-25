'use client';

import { useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { copyIssueAction } from './actions';

export function CopyIssue({ projectId, commentId }: { projectId: string; commentId: string }) {
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
    return <div className="flex min-w-0 flex-col gap-2">
        <Button size="xs" variant="plain" className="self-start pointer-coarse:min-h-11" disabled={pending} onClick={copy}>
            {pending ? 'Preparing issue…' : 'Copy issue'}
        </Button>
        {message && <p role={failed ? 'alert' : 'status'} className="m-0 text-xs text-muted-foreground">{message}</p>}
        {manual !== undefined && <>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Issue Markdown
                <textarea readOnly value={manual} onFocus={event => event.currentTarget.select()}
                    className="max-h-64 min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <Button size="xs" variant="plain" className="self-start" onClick={() => { setManual(undefined); setMessage(''); }}>Close copy text</Button>
        </>}
    </div>;
}
