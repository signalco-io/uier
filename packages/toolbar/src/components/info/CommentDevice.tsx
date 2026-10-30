import type { CommentDeviceSize, CommentItem } from '../@types/Comments';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { ArrowUpRight, Check, Copy, Desktop, Globe, Mobile, Tablet } from '@signalco/ui-icons';
import { useAnnounce } from '../Announcer';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { CommentTime } from '../CommentTime';
import { floatingShadowClassName } from '../@types/Comments';
import { useHoverPopover } from '../../hooks/useHoverPopover';

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

/** A line of the details: an icon, what it is and its values */
function DeviceRow({ icon, title, description, mono }: { icon: ReactNode; title: string; description: string; mono?: boolean }) {
    // Accent, not muted: muted is the popover's own colour in dark
    return (
        <div className="flex items-center gap-2.5 rounded-lg bg-accent px-2.5 py-2">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">{icon}</span>
            <div className="min-w-0">
                <p className="m-0 truncate text-sm font-medium text-foreground">{title}</p>
                <p className={cx('m-0 text-xs text-muted-foreground', mono && 'font-mono tabular-nums')}>{description}</p>
            </div>
        </div>
    );
}

/** Copy reproduction details, with the text to select by hand when the clipboard is not available */
function CopyReproduction({ text }: { text: string }) {
    const announce = useAnnounce();
    const [copied, setCopied] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timeout = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timeout);
    }, [copied]);

    return <>
        <Button variant="outlined" size="sm" startDecorator={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} onClick={async () => {
            try { await navigator.clipboard.writeText(text); setCopyFailed(false); setCopied(true); announce('Reproduction details copied'); }
            catch { setCopyFailed(true); }
        }}>Copy reproduction details</Button>
        {copyFailed && <>
            <p role="alert" className="m-0 text-xs text-muted-foreground">Couldn&rsquo;t copy. Select the details and copy them instead.</p>
            <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-2 font-mono text-xs">{text}</pre>
        </>}
    </>;
}

/**
 * The screen and the browser a comment was left from, as two icons next to its time, like the
 * app's `CommentDevice`. Hovering or clicking them shows the screen size and viewport; project
 * members (the API's member-only `reproduction`) also get the browser, OS, capture time and the
 * reviewed page, with the reproduction details to copy as text. Guests and public viewers never get
 * those, so they see the screen size icon only (and nothing when the size was not recorded).
 */
export function CommentDevice({ device, reproduction }: DeviceProps) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const popover = useHoverPopover();
    if (!device?.size && !reproduction) {
        return null;
    }

    const SizeIcon = sizeIcons[device?.size ?? 'desktop'];
    const screen = device?.size ? sizeLabels[device.size] : 'Unknown screen';
    const windowSize = reproduction?.windowSize ?? device?.windowSize;
    const viewport = [windowSize && `${windowSize[0]}×${windowSize[1]} CSS px`, reproduction?.pixelRatio && `${reproduction.pixelRatio}x`].filter(Boolean).join(' · ');
    const browser = reproduction?.browser ?? 'Unknown browser';
    const os = reproduction?.os ?? 'Unknown OS';
    // "Device: Desktop · 1280×720 px · Firefox (131) · macOS"; guests get the screen only
    const name = `Device: ${[screen, windowSize && `${windowSize[0]}×${windowSize[1]} px`, ...(reproduction ? [browser, os] : [])].filter(Boolean).join(' · ')}`;
    const capturedAt = reproduction?.capturedAt ? new Date(reproduction.capturedAt) : undefined;
    const captured = capturedAt && !Number.isNaN(capturedAt.valueOf()) ? capturedAt : undefined;

    return (
        <Popper
            container={rootElement}
            {...popover.root}
            align="start"
            aria-label={reproduction ? 'Device and browser' : 'Device'}
            className={cx('z-[70] flex w-72 flex-col gap-3 rounded-xl p-3', floatingShadowClassName)}
            trigger={(
                <Button
                    variant="plain"
                    size="xs"
                    className="h-6 shrink-0 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
                    aria-label={name}
                    {...popover.trigger}>
                    {/* No icon for a screen size that was not recorded: the desktop icon would say desktop */}
                    {device?.size && <SizeIcon size={14} aria-hidden="true" />}
                    {reproduction && <Globe size={14} aria-hidden="true" />}
                </Button>
            )}
            {...popover.content}>
            <div className="flex flex-col gap-1">
                <DeviceRow icon={<SizeIcon size={16} />} title={screen} description={viewport || 'Viewport unavailable'} mono />
                {reproduction && <DeviceRow icon={<Globe size={16} />} title={browser} description={os} />}
            </div>
            {(captured || reproduction?.url) && (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {captured && <span>Captured <CommentTime date={captured} /></span>}
                    {reproduction?.url && (
                        <a href={reproduction.url} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground">
                            Reviewed page
                            <ArrowUpRight size={12} aria-hidden="true" />
                        </a>
                    )}
                </div>
            )}
            {reproduction && <CopyReproduction text={reproduction.text} />}
        </Popper>
    );
}
