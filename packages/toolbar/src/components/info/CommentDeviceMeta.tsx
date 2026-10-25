import type { CommentDeviceSize, CommentItem } from '../@types/Comments';
import { useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { useAnnounce } from '../Announcer';

const sizeLabels: Record<CommentDeviceSize, string> = {
    desktop: 'Desktop',
    tablet: 'Tablet',
    mobile: 'Mobile'
};

/** "Desktop · 1280×720": the device size and viewport a comment was left from (mono: a machine wrote it) */
export function CommentDeviceMeta({ device, reproduction }: { device: CommentItem['device']; reproduction?: CommentItem['reproduction'] }) {
    const [expanded, setExpanded] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    const announce = useAnnounce();
    const parts = [
        device?.size ? sizeLabels[device.size] : undefined,
        device?.windowSize ? `${device.windowSize[0]}×${device.windowSize[1]}` : undefined
    ].filter(Boolean);
    if (!parts.length && !reproduction) {
        return null;
    }

    return (
        <div className="flex min-w-0 flex-col gap-1">
            {parts.length > 0 && <p className="m-0 font-mono text-xs tabular-nums text-muted-foreground" title="Device and viewport the comment was left from">{parts.join(' · ')}</p>}
            {reproduction && <>
                <p className="m-0 text-xs text-muted-foreground">{reproduction.browser ?? 'Unknown browser'} · {reproduction.os ?? 'Unknown OS'}</p>
                <Button variant="plain" size="xs" className="self-start" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Reproduction details</Button>
                {expanded && <div className="flex min-w-0 flex-col gap-2">
                    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{reproduction.text}</pre>
                    {reproduction.url && <a href={reproduction.url} target="_blank" rel="noopener" className="text-xs underline">Reviewed page</a>}
                    <Button variant="plain" size="xs" className="self-start" onClick={async () => {
                        try { await navigator.clipboard.writeText(reproduction.text); setCopyFailed(false); announce('Reproduction details copied'); }
                        catch { setCopyFailed(true); }
                    }}>Copy reproduction details</Button>
                    {copyFailed && <p role="alert" className="m-0 text-xs text-muted-foreground">Couldn&rsquo;t copy. Select the details and copy them instead.</p>}
                </div>}
            </>}
        </div>
    );
}
