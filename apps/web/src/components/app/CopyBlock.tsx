'use client';

import { IconButtonCopyToClipboard } from '@signalco/ui/IconButtonCopyToClipboard';
import { Copy } from '@signalco/ui-icons';

/** Code (mono, machine-written) with a copy button */
export function CopyBlock({ value, label }: { value: string; label: string }) {
    return (
        <div className="relative rounded-xl border bg-muted">
            <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all py-3 pl-4 pr-14 font-mono text-[13px] leading-5">
                <code>{value}</code>
            </pre>
            <div className="absolute right-2 top-1.5">
                <IconButtonCopyToClipboard
                    title={label}
                    value={value}
                    successMessage="Copied"
                    errorMessage="Couldn't copy. Select the text and copy it instead.">
                    <Copy />
                </IconButtonCopyToClipboard>
            </div>
        </div>
    );
}
