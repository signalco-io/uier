'use client';

import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';

/** Code (mono, machine-written) with a copy button */
export function CopyBlock({ value, label }: { value: string; label: string }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Couldn\'t copy. Select the text and copy it instead.');
        }
    };

    return (
        <div className="relative rounded-lg border bg-muted/60">
            <pre className="m-0 overflow-x-auto py-2.5 pr-12 pl-3 font-mono text-[13px] leading-5 break-all whitespace-pre-wrap">
                <code>{value}</code>
            </pre>
            <div className="absolute top-1 right-1">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={label} onClick={copy}>
                            {copied ? <CheckIcon /> : <CopyIcon />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>{copied ? 'Copied' : 'Copy'}</TooltipContent>
                </Tooltip>
            </div>
            <span role="status" className="sr-only">{copied ? 'Copied' : ''}</span>
        </div>
    );
}
