import type { ReactNode } from 'react';
import { browserKind, browserMarks, osKind, osMarks, type DeviceMark as Mark, type DeviceSettings } from '../devices';
import { deviceIcons, type DeviceIconName } from './icons';

/**
 * The details of the device a comment was left from, drawn the same way in the app's and the toolbar's
 * "Device and browser" popover (`@uier/toolbar/device-details`): the screen and browser rows, the recorded settings
 * as two-column tiles, the capture time and the reviewed page. Presentational only: each surface keeps its own popover,
 * time element and Copy reproduction details button (`children`), and passes every word in its own language.
 * No UI-kit imports and inline Lucide icons, so the app's bundle and the toolbar's shadow root both take it as it is.
 *
 * Class names are full strings in this folder: both Tailwind builds (the toolbar's and the app's, `@source`) read
 * them from here. Rows and tiles are `bg-accent/70`: `muted` is the popover's own colour in dark.
 */

export type { DeviceIconName } from './icons';
export type DeviceSize = 'desktop' | 'tablet' | 'mobile';

const sizeIcons: Record<DeviceSize, DeviceIconName> = { desktop: 'desktop', tablet: 'tablet', mobile: 'mobile' };

/** A Lucide icon (ISC) by name, decorative; `svg.lucide` gives it the 1.75 stroke in both themes */
export function DeviceIcon({ name, size = 16, className }: { name: DeviceIconName; size?: number; className?: string }) {
    return (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" className={className ? `lucide shrink-0 ${className}` : 'lucide shrink-0'} data-device-icon={name}>
            {deviceIcons[name].map(([Tag, attributes], index) => <Tag key={index} {...attributes} />)}
        </svg>
    );
}

function MarkSvg({ mark, size, className, ...data }: { mark: Mark; size: number; className?: string } & Record<`data-${string}`, string>) {
    return (
        <svg aria-hidden="true" viewBox={mark.viewBox} width={size} height={size} focusable="false" className={className ? `shrink-0 ${className}` : 'shrink-0'} {...data}
            fill={mark.stroke ? 'none' : 'currentColor'}
            {...(mark.stroke ? { stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : {})}>
            {mark.paths.map(d => <path key={d} d={d} />)}
        </svg>
    );
}

/**
 * The mark of the browser a comment was left from ("Microsoft Edge (156)", `devices.ts`), one colour in the text
 * colour like `AgentMark`, a globe when unknown. Decorative: the browser's name is always written beside it.
 * `size` sets the attributes; a `size-*` class overrides them.
 */
export function BrowserMark({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
    const kind = browserKind(name);
    return <MarkSvg mark={browserMarks[kind]} size={size} className={className} data-browser-mark={kind} />;
}

/** The mark of the operating system a comment was left from ("macOS"), a window when unknown. Decorative, like `BrowserMark`. */
export function OsMark({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
    const kind = osKind(name);
    return <MarkSvg mark={osMarks[kind]} size={size} className={className} data-os-mark={kind} />;
}

/** The tiles' words in the viewer's language: short ones, since a tile is half the popover wide */
export type DeviceTileWords = {
    model: string; input: string; theme: string; motion: string; language: string;
    touch: string; mouse: string; light: string; dark: string; reduced: string; standard: string;
};

export type DeviceTile = { key: 'model' | 'input' | 'colorScheme' | 'reducedMotion' | 'pageLanguage'; icon: DeviceIconName; label: string; value: string };

/**
 * The recorded settings as tiles, in `deviceSettings`' order (model, input, colour scheme, reduced motion, page
 * language), each with the icon its value calls for. The copied details and feedback packets keep `deviceSettings`'
 * full wording ("Mouse or trackpad", "Reduced motion: On"); older comments have none.
 */
export function deviceTiles(device: DeviceSettings, words: DeviceTileWords): DeviceTile[] {
    const tiles: (DeviceTile | false | undefined)[] = [
        !!device.model && { key: 'model', icon: 'mobile', label: words.model, value: device.model },
        device.input && { key: 'input', icon: device.input === 'touch' ? 'touch' : 'mouse', label: words.input, value: words[device.input] },
        device.colorScheme && { key: 'colorScheme', icon: device.colorScheme, label: words.theme, value: words[device.colorScheme] },
        device.reducedMotion !== undefined && { key: 'reducedMotion', icon: 'motion', label: words.motion, value: device.reducedMotion ? words.reduced : words.standard },
        !!device.pageLanguage && { key: 'pageLanguage', icon: 'language', label: words.language, value: device.pageLanguage }
    ];
    return tiles.filter((tile): tile is DeviceTile => !!tile);
}

/** A line of the details: an icon or mark, what it is and its values */
function DeviceRow({ media, title, description, mono }: { media: ReactNode; title: string; description: ReactNode; mono?: boolean }) {
    return (
        <div className="flex min-w-0 items-center gap-2.5 rounded-md bg-accent/70 px-2.5 py-2 text-foreground">
            <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">{media}</span>
            <div className="flex min-w-0 flex-1 flex-col">
                <p className="m-0 truncate text-sm leading-snug font-medium">{title}</p>
                <p className={mono ? 'm-0 flex min-w-0 items-center gap-1 font-mono text-xs leading-normal text-muted-foreground tabular-nums' : 'm-0 flex min-w-0 items-center gap-1 text-xs leading-normal text-muted-foreground'}>{description}</p>
            </div>
        </div>
    );
}

export type DeviceDetailsProps = {
    /** The recorded screen size; the screen row shows a monitor when unknown */
    size?: DeviceSize;
    /** "Desktop", or "Unknown screen" */
    screen: string;
    /** "1673×1318 CSS px · 1x", or "Viewport unavailable" */
    viewport: string;
    /** The browser and system with their marks; members only (guests and public viewers see the screen row alone) */
    system?: { browser?: string; os?: string; browserLabel: string; osLabel: string };
    tiles?: DeviceTile[];
    /** "Captured" and the surface's own time element */
    captured?: ReactNode;
    reviewedPage?: { href: string; label: string };
    /** The surface's actions under the details: Copy reproduction details */
    children?: ReactNode;
};

/** The popover's content: put it in a `flex flex-col gap-3` popover (the app's `PopoverContent`, the toolbar's `Popper`) */
export function DeviceDetails({ size, screen, viewport, system, tiles = [], captured, reviewedPage, children }: DeviceDetailsProps) {
    return <>
        <div className="flex flex-col gap-1">
            <DeviceRow media={<DeviceIcon name={size ? sizeIcons[size] : 'desktop'} />} title={screen} description={viewport} mono />
            {system && (
                <DeviceRow
                    media={<BrowserMark name={system.browser} />}
                    title={system.browserLabel}
                    description={<><OsMark name={system.os} size={14} /><span className="truncate">{system.osLabel}</span></>} />
            )}
        </div>
        {/* Tiles like the rows above: the icon, the value, its name under it (the term first for assistive tech) */}
        {tiles.length > 0 && (
            <dl className="m-0 grid grid-cols-2 gap-1">
                {tiles.map(tile => (
                    // A dl allows only dt and dd in its div groups, so the icon sits in the term
                    <div key={tile.key} className="relative flex min-w-0 flex-col rounded-md bg-accent/70 py-2 pr-2.5 pl-8.5">
                        <dt className="order-2 truncate text-xs leading-normal text-muted-foreground">
                            <DeviceIcon name={tile.icon} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-foreground" />
                            {tile.label}
                        </dt>
                        <dd className="order-1 m-0 truncate text-sm leading-snug font-medium text-foreground" title={tile.value}>{tile.value}</dd>
                    </div>
                ))}
            </dl>
        )}
        {(captured || reviewedPage) && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {captured && <span>{captured}</span>}
                {reviewedPage && (
                    <a href={reviewedPage.href} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-muted-foreground underline underline-offset-2 hover:text-foreground">
                        {reviewedPage.label}
                        <DeviceIcon name="external" size={12} />
                    </a>
                )}
            </div>
        )}
        {children}
    </>;
}
