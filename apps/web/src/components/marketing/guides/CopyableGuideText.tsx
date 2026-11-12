'use client';

import { useRef, useState, type PropsWithChildren } from 'react';
import { Button } from '@signalco/ui-primitives/Button';

/** The document stays server-rendered. Only its explicit copy action needs client code. */
export function CopyableGuideText({ text, label, children }: PropsWithChildren<{ text: string; label: string }>) {
    const root = useRef<HTMLDivElement>(null);
    const [notice, setNotice] = useState('');
    async function copy() {
        try {
            await navigator.clipboard.writeText(text);
            setNotice('Copied.');
        } catch {
            const pre = root.current?.querySelector('pre');
            if (pre) {
                pre.focus();
                const range = document.createRange();
                range.selectNodeContents(pre);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
            }
            setNotice('Select the text below and copy it with your browser.');
        }
    }
    return <div ref={root} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outlined" onClick={copy}>{label}</Button>
            <span role="status" className="text-sm text-muted-foreground">{notice}</span>
        </div>
        {children}
    </div>;
}
