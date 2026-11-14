import type { CommentDeviceSize, CommentItem } from '../@types/Comments';
import { useContext, useEffect, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { Check, Copy, Desktop, Mobile, Tablet } from '@signalco/ui-icons';
import { useAnnounce } from '../Announcer';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { CommentTime } from '../CommentTime';
import { floatingShadowClassName } from '../@types/Comments';
import { useHoverPopover } from '../../hooks/useHoverPopover';
import { BrowserMark, DeviceDetails, deviceTiles } from '../../deviceDetails';
import { useMessages } from '../../i18n';
import { toolbarSurface } from '../../toolbarReview';

const sizeIcons: Record<CommentDeviceSize, typeof Desktop> = {
    desktop: Desktop,
    tablet: Tablet,
    mobile: Mobile
};

type DeviceProps = { device: CommentItem['device']; reproduction?: CommentItem['reproduction'] };

/** Copy reproduction details, with the text to select by hand when the clipboard is not available */
function CopyReproduction({ text }: { text: string }) {
    const announce = useAnnounce();
    const t = useMessages();
    const [copied, setCopied] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timeout = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timeout);
    }, [copied]);

    return <>
        <Button variant="outlined" size="sm" startDecorator={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} onClick={async () => {
            try { await navigator.clipboard.writeText(text); setCopyFailed(false); setCopied(true); announce(t.device.copied); }
            catch { setCopyFailed(true); }
        }}>{t.device.copy}</Button>
        {copyFailed && <>
            <p role="alert" className="m-0 text-xs text-muted-foreground">{t.device.notCopied}</p>
            <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-2 font-mono text-xs">{text}</pre>
        </>}
    </>;
}

/**
 * The screen and the browser a comment was left from, as two icons next to its time, like the
 * app's `CommentDevice` (the browser's own mark, `BrowserMark`, or a globe when unknown). Hovering or
 * clicking them shows the details, drawn by `DeviceDetails` (`@uier/toolbar/device-details`), the app's too:
 * the screen size and viewport; project members (the API's member-only `reproduction`) also get the browser and
 * OS with their marks, the model, input, colour scheme, reduced motion and page language as tiles when recorded,
 * capture time and the reviewed page, with the reproduction details to copy as text. Guests and public viewers never
 * get those, so they see the screen size icon only (and nothing when the size was not recorded).
 */
export function CommentDevice({ device, reproduction }: DeviceProps) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const popover = useHoverPopover();
    const t = useMessages();
    if (!device?.size && !reproduction) {
        return null;
    }

    const SizeIcon = sizeIcons[device?.size ?? 'desktop'];
    const screen = device?.size ? t.device.sizes[device.size] : t.device.unknownScreen;
    const windowSize = reproduction?.windowSize ?? device?.windowSize;
    const viewport = [windowSize && `${windowSize[0]}×${windowSize[1]} CSS px`, reproduction?.pixelRatio && `${reproduction.pixelRatio}x`].filter(Boolean).join(' · ');
    const browser = reproduction?.browser ?? t.device.unknownBrowser;
    const os = reproduction?.os ?? t.device.unknownOs;
    // "Device: Desktop · 1280×720 px · Firefox (131) · macOS"; guests get the screen only
    const name = t.device.name([screen, windowSize && `${windowSize[0]}×${windowSize[1]} px`, ...(reproduction ? [browser, os] : [])].filter(Boolean).join(' · '));
    const capturedAt = reproduction?.capturedAt ? new Date(reproduction.capturedAt) : undefined;
    const captured = capturedAt && !Number.isNaN(capturedAt.valueOf()) ? capturedAt : undefined;

    return (
        <Popper
            container={rootElement}
            {...popover.root}
            align="start"
            aria-label={reproduction ? t.device.deviceAndBrowser : t.device.device}
            {...toolbarSurface('uier-device', cx('z-[70] flex w-72 flex-col gap-3 rounded-xl p-3', floatingShadowClassName))}
            trigger={(
                <Button
                    variant="plain"
                    size="xs"
                    className="h-6 shrink-0 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
                    aria-label={name}
                    {...popover.trigger}>
                    {/* No icon for a screen size that was not recorded: the desktop icon would say desktop */}
                    {device?.size && <SizeIcon size={14} aria-hidden="true" />}
                    {reproduction && <BrowserMark name={reproduction.browser} size={14} />}
                </Button>
            )}
            {...popover.content}>
            <DeviceDetails
                size={device?.size}
                screen={screen}
                viewport={viewport || t.device.viewportUnavailable}
                system={reproduction && { browser: reproduction.browser, os: reproduction.os, browserLabel: browser, osLabel: os }}
                tiles={reproduction ? deviceTiles(reproduction, t.device.tiles) : []}
                captured={captured && <>{t.device.captured}<CommentTime date={captured} /></>}
                reviewedPage={reproduction?.url ? { href: reproduction.url, label: t.device.reviewedPage } : undefined}>
                {reproduction && <CopyReproduction text={reproduction.text} />}
            </DeviceDetails>
        </Popper>
    );
}
