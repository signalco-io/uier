'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useState } from 'react';
import { deviceSettings } from '@uier/toolbar/devices';
import {
    AccessibilityIcon, ArrowUpRightIcon, CheckIcon, CopyIcon, HandIcon, LanguagesIcon, MonitorIcon, MoonIcon, MousePointer2Icon,
    SmartphoneIcon, SunIcon, TabletIcon, type LucideIcon
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import type { ReproductionContext } from '../../../lib/comments/reproduction';
import type { DbDeviceSize } from '../../../lib/db/schema';
import { hoverPopoverTrigger } from '../hoverPopover';
import { DateTime } from './DateTime';
import { BrowserMark, OsMark } from './DeviceMark';
import { deviceLabels } from './commentLabels';

const deviceIcons = { desktop: MonitorIcon, tablet: TabletIcon, mobile: SmartphoneIcon } as const;

/** The icon beside each recorded setting (`deviceSettings` labels), chosen by its value where that differs */
const settingIcons: Record<string, (value: string) => LucideIcon> = {
    Model: () => SmartphoneIcon,
    Input: value => value === 'Touch' ? HandIcon : MousePointer2Icon,
    'Colour scheme': value => value === 'Dark' ? MoonIcon : SunIcon,
    'Reduced motion': () => AccessibilityIcon,
    'Page language': () => LanguagesIcon
};

/**
 * Shorter words for the tiles, which are too narrow for the full ones; the copied details and the
 * feedback packet keep `deviceSettings`' wording ("Mouse or trackpad", "Reduced motion: On")
 */
const tileLabels: Record<string, string> = { 'Colour scheme': 'Theme', 'Reduced motion': 'Motion', 'Page language': 'Language' };
const tileValues: Record<string, Record<string, string>> = {
    Input: { 'Mouse or trackpad': 'Mouse' },
    'Reduced motion': { On: 'Reduced', Off: 'Standard' }
};

/**
 * The screen and the browser a comment was left from, as two icons next to its time (the browser's own
 * mark, `DeviceMark`, or a globe when unknown). Hovering or clicking them shows the original capture
 * (size, viewport, the browser and OS with their marks, then the model, input, colour scheme, reduced
 * motion and page language when recorded, each a tile with its icon, time and the reviewed page) with the reproduction details to
 * copy as text. Only authorized project members get this context (`reproduction.ts`).
 */
export function CommentDevice({ device, context }: { device?: DbDeviceSize; context: ReproductionContext }) {
    const { t } = useAppI18n();
    const [copied, setCopied] = useState(false);
    const { windowSize, pixelRatio } = context;
    const SizeIcon = device ? deviceIcons[device] : MonitorIcon;
    const screen = device ? t(deviceLabels[device]) : t("Unknown screen");
    const viewport = [windowSize && `${windowSize[0]}×${windowSize[1]} CSS px`, pixelRatio && `${pixelRatio}x`].filter(Boolean).join(' · ');
    const browser = context.browser ?? t("Unknown browser");
    const os = context.os ?? t("Unknown OS");
    const settings = deviceSettings(context);
    // "Device: Desktop · 1674×1318 px · Firefox (131) · macOS"
    const name = t("Device: {value0}", { value0: [screen, windowSize && `${windowSize[0]}×${windowSize[1]} px`, browser, os].filter(Boolean).join(' · ') });

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(context.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error(t("Couldn't copy. Select the details and copy them instead."));
        }
    };

    return (
        <Popover>
            <PopoverTrigger {...hoverPopoverTrigger} render={<Button variant="ghost" size="xs" className="shrink-0 px-1.5 text-muted-foreground hover:text-foreground pointer-coarse:min-h-11" />}>
                {/* No icon for a screen size that was not recorded: a monitor would say desktop */}
                {device && <SizeIcon aria-hidden="true" className="size-3.5" />}
                <BrowserMark name={context.browser} className="size-3.5" />
                <span className="sr-only">{name}</span>
            </PopoverTrigger>
            <PopoverContent align="start" aria-label={t("Device and browser")} className="w-72 gap-3 p-3">
                <div className="flex flex-col gap-1">
                    <Item size="xs" variant="muted">
                        <ItemMedia variant="icon"><SizeIcon aria-hidden="true" /></ItemMedia>
                        <ItemContent>
                            <ItemTitle>{screen}</ItemTitle>
                            <ItemDescription className="font-mono tabular-nums">{viewport || t("Viewport unavailable")}</ItemDescription>
                        </ItemContent>
                    </Item>
                    <Item size="xs" variant="muted">
                        <ItemMedia variant="icon"><BrowserMark name={context.browser} /></ItemMedia>
                        <ItemContent>
                            <ItemTitle>{browser}</ItemTitle>
                            <ItemDescription className="flex items-center gap-1"><OsMark name={context.os} className="size-3.5" />{os}</ItemDescription>
                        </ItemContent>
                    </Item>
                </div>
                {/* Tiles like the screen and browser rows: the icon, the value, its name under it (the term first for assistive tech) */}
                {settings.length > 0 && (
                    <dl className="m-0 grid grid-cols-2 gap-1">
                        {settings.map(([name, value]) => {
                            const Icon = settingIcons[name]?.(value) ?? MonitorIcon;
                            return (
                                // A dl allows only dt and dd in its div groups, so the icon sits in the term
                                <div key={name} className="relative flex min-w-0 flex-col rounded-md bg-muted/50 py-2 pr-2.5 pl-8.5">
                                    <dt className="order-2 truncate text-xs text-muted-foreground">
                                        <Icon aria-hidden="true" className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground" />
                                        {t(tileLabels[name] ?? name)}
                                    </dt>
                                    <dd className="order-1 m-0 truncate text-sm leading-snug font-medium" title={value}>{name === 'Model' || name === 'Page language' ? value : t(tileValues[name]?.[value] ?? value)}</dd>
                                </div>
                            );
                        })}
                    </dl>
                )}
                {(context.capturedAt || context.url) && (
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {context.capturedAt && <span>{t("Captured ")}<DateTime value={context.capturedAt} /></span>}
                        {context.url && (
                            <a href={context.url} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground">
                                {t("Reviewed page")}
                                <ArrowUpRightIcon aria-hidden="true" className="size-3" />
                            </a>
                        )}
                    </div>
                )}
                <Button variant="outline" size="sm" onClick={copy}>
                    {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                    {t("Copy reproduction details")}
                </Button>
                <span role="status" className="sr-only">{copied ? t("Copied") : ''}</span>
            </PopoverContent>
        </Popover>
    );
}
