'use client';

import { useState } from 'react';
import { ArrowUpRightIcon, CheckIcon, CopyIcon, GlobeIcon, MonitorIcon, SmartphoneIcon, TabletIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import type { ReproductionContext } from '../../../lib/comments/reproduction';
import type { DbDeviceSize } from '../../../lib/db/schema';
import { useHoverPopover } from '../useHoverPopover';
import { DateTime } from './DateTime';
import { deviceLabels } from './commentLabels';

const deviceIcons = { desktop: MonitorIcon, tablet: TabletIcon, mobile: SmartphoneIcon } as const;

/**
 * The screen and the browser a comment was left from, as two icons next to its time. Hovering or
 * clicking them shows the original capture (size, viewport, browser, OS, time and the reviewed
 * page) with the reproduction details to copy as text. Only authorized project members get this
 * context (`reproduction.ts`).
 */
export function CommentDevice({ device, context }: { device?: DbDeviceSize; context: ReproductionContext }) {
    const popover = useHoverPopover();
    const [copied, setCopied] = useState(false);
    const { windowSize, pixelRatio } = context;
    const SizeIcon = device ? deviceIcons[device] : MonitorIcon;
    const screen = device ? deviceLabels[device] : 'Unknown screen';
    const viewport = [windowSize && `${windowSize[0]}×${windowSize[1]} CSS px`, pixelRatio && `${pixelRatio}x`].filter(Boolean).join(' · ');
    const browser = context.browser ?? 'Unknown browser';
    const os = context.os ?? 'Unknown OS';
    // "Device: Desktop · 1674×1318 px · Firefox (131) · macOS"
    const name = `Device: ${[screen, windowSize && `${windowSize[0]}×${windowSize[1]} px`, browser, os].filter(Boolean).join(' · ')}`;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(context.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Couldn\'t copy. Select the details and copy them instead.');
        }
    };

    return (
        <Popover {...popover.root}>
            <PopoverTrigger asChild {...popover.trigger}>
                <Button variant="ghost" size="xs" className="shrink-0 px-1.5 text-muted-foreground hover:text-foreground pointer-coarse:min-h-11">
                    {/* No icon for a screen size that was not recorded: a monitor would say desktop */}
                    {device && <SizeIcon aria-hidden="true" className="size-3.5" />}
                    <GlobeIcon aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">{name}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" aria-label="Device and browser" className="w-72 gap-3 p-3" {...popover.content}>
                <div className="flex flex-col gap-1">
                    <Item size="xs" variant="muted">
                        <ItemMedia variant="icon"><SizeIcon aria-hidden="true" /></ItemMedia>
                        <ItemContent>
                            <ItemTitle>{screen}</ItemTitle>
                            <ItemDescription className="font-mono tabular-nums">{viewport || 'Viewport unavailable'}</ItemDescription>
                        </ItemContent>
                    </Item>
                    <Item size="xs" variant="muted">
                        <ItemMedia variant="icon"><GlobeIcon aria-hidden="true" /></ItemMedia>
                        <ItemContent>
                            <ItemTitle>{browser}</ItemTitle>
                            <ItemDescription>{os}</ItemDescription>
                        </ItemContent>
                    </Item>
                </div>
                {(context.capturedAt || context.url) && (
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {context.capturedAt && <span>Captured <DateTime value={context.capturedAt} /></span>}
                        {context.url && (
                            <a href={context.url} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground">
                                Reviewed page
                                <ArrowUpRightIcon aria-hidden="true" className="size-3" />
                            </a>
                        )}
                    </div>
                )}
                <Button variant="outline" size="sm" onClick={copy}>
                    {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                    Copy reproduction details
                </Button>
                <span role="status" className="sr-only">{copied ? 'Copied' : ''}</span>
            </PopoverContent>
        </Popover>
    );
}
