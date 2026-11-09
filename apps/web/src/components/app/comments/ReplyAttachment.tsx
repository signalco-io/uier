'use client';

import { useId, useRef } from 'react';
import { PaperclipIcon, XIcon } from 'lucide-react';
import type { useAttachedImage } from '@uier/toolbar/attachments';
import { screenshotContentTypes } from '@uier/toolbar/screenshot-policy';
import { Button } from '@/src/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';

export function ReplyAttachment({ attachment }: { attachment: ReturnType<typeof useAttachedImage> }) {
    const input = useRef<HTMLInputElement>(null);
    const limits = useId();
    const { image, reading } = attachment;
    return <>
        <span id={limits} className="sr-only">PNG, JPEG or WebP, up to 512 KB and 4096 pixels on each side.</span>
        <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size={image ? 'xs' : 'icon-xs'}
                className="min-w-0 max-w-40 shrink pointer-coarse:min-h-11 pointer-coarse:min-w-11" disabled={reading}
                aria-describedby={limits} aria-label={image ? `Remove attached image ${image.name}` : 'Attach image'}
                onClick={() => image ? attachment.remove() : input.current?.click()} />}>
                <PaperclipIcon data-icon="inline-start" />
                {image && <><span className="truncate">{image.name}</span><XIcon data-icon="inline-end" /></>}
            </TooltipTrigger>
            <TooltipContent>{image ? 'Remove attached image' : 'Attach an image to your reply'}</TooltipContent>
        </Tooltip>
        <input ref={input} type="file" accept={screenshotContentTypes.join(',')} tabIndex={-1} aria-hidden="true" className="hidden"
            onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void attachment.attach(file);
            }} />
    </>;
}
