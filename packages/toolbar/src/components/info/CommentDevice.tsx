import type { CommentDeviceSize, CommentItem } from '../@types/Comments';
import { Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { ArrowUpRight, Check, Copy, Desktop, Mobile, Tablet } from '@signalco/ui-icons';
import { useAnnounce } from '../Announcer';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { CommentTime } from '../CommentTime';
import { floatingShadowClassName } from '../@types/Comments';
import { useHoverPopover } from '../../hooks/useHoverPopover';
import { BrowserMark, OsMark } from './DeviceMark';
import { useMessages } from '../../i18n';
import { deviceSettingsText } from '../../i18n/format';
import { toolbarSurface } from '../../toolbarReview';

const sizeIcons: Record<CommentDeviceSize, typeof Desktop> = {
    desktop: Desktop,
    tablet: Tablet,
    mobile: Mobile
};

type DeviceProps = { device: CommentItem['device']; reproduction?: CommentItem['reproduction'] };

/** A line of the details: an icon, what it is and its values */
function DeviceRow({ icon, title, description, mono }: { icon: ReactNode; title: string; description: ReactNode; mono?: boolean }) {
    // Accent, not muted: muted is the popover's own colour in dark
    return (
        <div className="flex items-center gap-2.5 rounded-lg bg-accent px-2.5 py-2">
            <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">{icon}</span>
            <div className="min-w-0">
                <p className="m-0 truncate text-sm font-medium text-foreground">{title}</p>
                <p className={cx('m-0 flex items-center gap-1 text-xs text-muted-foreground', mono && 'font-mono tabular-nums')}>{description}</p>
            </div>
        </div>
    );
}

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
 * app's `CommentDevice` (the browser's own mark, `DeviceMark`, or a globe when unknown). Hovering or
 * clicking them shows the screen size and viewport; project members (the API's member-only
 * `reproduction`) also get the browser and OS with their marks, the model, input, colour scheme, reduced motion and page
 * language when recorded, capture time and the reviewed page, with the reproduction details to copy as text. Guests and public viewers never get
 * those, so they see the screen size icon only (and nothing when the size was not recorded).
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
    const settings = reproduction ? deviceSettingsText(reproduction, t) : [];
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
            <div className="flex flex-col gap-1">
                <DeviceRow icon={<SizeIcon size={16} />} title={screen} description={viewport || t.device.viewportUnavailable} mono />
                {reproduction && <DeviceRow icon={<BrowserMark name={reproduction.browser} />} title={browser} description={<><OsMark name={reproduction.os} size={14} />{os}</>} />}
            </div>
            {settings.length > 0 && (
                <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-1 text-xs">
                    {settings.map(([name, value]) => (
                        <Fragment key={name}>
                            <dt className="text-muted-foreground">{name}</dt>
                            <dd className="m-0 truncate text-foreground">{value}</dd>
                        </Fragment>
                    ))}
                </dl>
            )}
            {(captured || reproduction?.url) && (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {captured && <span>{t.device.captured}<CommentTime date={captured} /></span>}
                    {reproduction?.url && (
                        <a href={reproduction.url} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground">
                            {t.device.reviewedPage}
                            <ArrowUpRight size={12} aria-hidden="true" />
                        </a>
                    )}
                </div>
            )}
            {reproduction && <CopyReproduction text={reproduction.text} />}
        </Popper>
    );
}
