import type { CommentDeviceSize, CommentItem } from '../@types/Comments';
import { useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Copy, Desktop, Mobile, Tablet } from '@signalco/ui-icons';
import { useAnnounce } from '../Announcer';

const sizeLabels: Record<CommentDeviceSize, string> = {
    desktop: 'Desktop',
    tablet: 'Tablet',
    mobile: 'Mobile'
};

const sizeIcons: Record<CommentDeviceSize, typeof Desktop> = {
    desktop: Desktop,
    tablet: Tablet,
    mobile: Mobile
};

type DeviceProps = { device: CommentItem['device']; reproduction?: CommentItem['reproduction'] };

/** "Desktop · 1280×720": the device size and viewport a comment was left from */
function deviceSummary(device: CommentItem['device']) {
    return [
        device?.size ? sizeLabels[device.size] : undefined,
        device?.windowSize ? `${device.windowSize[0]}×${device.windowSize[1]}` : undefined
    ].filter(Boolean).join(' · ');
}

function browserSummary(reproduction: CommentItem['reproduction']) {
    return reproduction ? `${reproduction.browser ?? 'Unknown browser'} · ${reproduction.os ?? 'Unknown OS'}` : '';
}

export function hasDeviceMeta(device: CommentItem['device'], reproduction?: CommentItem['reproduction']) {
    return Boolean(deviceSummary(device) || reproduction);
}

/**
 * The device a comment was left from, as an icon next to its time: the size and viewport (and, for
 * members, the browser) in its tooltip and name; a click shows them, with the reproduction details.
 */
export function CommentDeviceButton({ device, reproduction, expanded, controls, onToggle }: DeviceProps & {
    expanded: boolean;
    /** The id of the details it shows */
    controls: string;
    onToggle: () => void;
}) {
    const summary = [deviceSummary(device), browserSummary(reproduction)].filter(Boolean).join(', ');
    const Icon = sizeIcons[device?.size ?? 'desktop'];
    return (
        <IconButton
            size="xs"
            variant="plain"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground aria-expanded:text-foreground"
            title={summary}
            aria-label={`Device: ${summary}`}
            aria-expanded={expanded}
            aria-controls={controls}
            onClick={onToggle}>
            <Icon size={14} />
        </IconButton>
    );
}

/** What the device button shows: size, viewport, browser and the reproduction details to copy */
export function CommentDeviceDetails({ id, device, reproduction }: DeviceProps & { id: string }) {
    const [copyFailed, setCopyFailed] = useState(false);
    const announce = useAnnounce();
    const summary = deviceSummary(device);

    return (
        <div id={id} className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
            {summary && <p className="m-0 font-mono tabular-nums text-foreground" title="Device and viewport the comment was left from">{summary}</p>}
            {reproduction && <>
                <p className="m-0">{browserSummary(reproduction)}</p>
                <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">{reproduction.text}</pre>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Button variant="plain" size="xs" className="-ml-2" startDecorator={<Copy size={14} aria-hidden="true" />} onClick={async () => {
                        try { await navigator.clipboard.writeText(reproduction.text); setCopyFailed(false); announce('Reproduction details copied'); }
                        catch { setCopyFailed(true); }
                    }}>Copy reproduction details</Button>
                    {reproduction.url && <a href={reproduction.url} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-foreground">Reviewed page</a>}
                </div>
                {copyFailed && <p role="alert" className="m-0">Couldn&rsquo;t copy. Select the details and copy them instead.</p>}
            </>}
        </div>
    );
}
