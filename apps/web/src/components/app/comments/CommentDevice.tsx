'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useState } from 'react';
import { BrowserMark, DeviceDetails, deviceTiles } from '@uier/toolbar/device-details';
import { CheckIcon, CopyIcon, MonitorIcon, SmartphoneIcon, TabletIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import type { ReproductionContext } from '../../../lib/comments/reproduction';
import type { DbDeviceSize } from '../../../lib/db/schema';
import { hoverPopoverTrigger } from '../hoverPopover';
import { DateTime } from './DateTime';
import { deviceLabels } from './commentLabels';

const deviceIcons = { desktop: MonitorIcon, tablet: TabletIcon, mobile: SmartphoneIcon } as const;

/**
 * The screen and the browser a comment was left from, as two icons next to its time (the browser's own
 * mark, `BrowserMark`, or a globe when unknown). Hovering or clicking them shows the original capture, drawn by
 * `DeviceDetails` (`@uier/toolbar/device-details`), the toolbar's too: size, viewport, the browser and OS with their
 * marks, then the model, input, colour scheme, reduced motion and page language when recorded, each a tile with its
 * icon and a short word (`deviceTiles`), the time and the reviewed page, with the reproduction details to copy as text.
 * Only authorized project members get this context (`reproduction.ts`).
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
    const tiles = deviceTiles(context, {
        model: t("Model"), input: t("Input"), theme: t("Theme"), motion: t("Motion"), language: t("Language"),
        touch: t("Touch"), mouse: t("Mouse"), light: t("Light"), dark: t("Dark"), reduced: t("Reduced"), standard: t("Standard")
    });
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
                <DeviceDetails
                    size={device}
                    screen={screen}
                    viewport={viewport || t("Viewport unavailable")}
                    system={{ browser: context.browser, os: context.os, browserLabel: browser, osLabel: os }}
                    tiles={tiles}
                    captured={context.capturedAt && <>{t("Captured ")}<DateTime value={context.capturedAt} /></>}
                    reviewedPage={context.url ? { href: context.url, label: t("Reviewed page") } : undefined}>
                    <Button variant="outline" size="sm" onClick={copy}>
                        {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                        {t("Copy reproduction details")}
                    </Button>
                    <span role="status" className="sr-only">{copied ? t("Copied") : ''}</span>
                </DeviceDetails>
            </PopoverContent>
        </Popover>
    );
}
