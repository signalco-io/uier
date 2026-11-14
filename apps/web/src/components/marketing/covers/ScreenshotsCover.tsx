'use client';

import type { ReactNode } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { CameraIcon, CheckIcon, PaperclipIcon, SendIcon } from 'lucide-react';
import { Pin } from '@uier/brand/Pin';
import { DeviceDetails, DeviceIcon, BrowserMark, type DeviceTile } from '@uier/toolbar/device-details';
import { floating, Message, ThreadHeader } from '../LandingSpecimens';
import { appear, fade, FeatureCover, type CoverCaption } from './FeatureCover';

// /features/screenshots: a comment left on a phone. The toolbar takes a screenshot of the spot while
// the comment is written (Attach screenshot pressed, its status read out under the text box), the
// thread shows it as a thumbnail with the browser and screen after the time, the device details open
// (the shared `DeviceDetails` of @uier/toolbar/device-details, as the toolbar and the app draw them),
// then Redact screenshot covers the guest's name with an opaque box. The words are the toolbar's
// (ComposerScreenshotToggle, CommentDevice, ScreenshotRedaction); recheck with
// packages/toolbar/docs/screenshots.md and device-details.md.

const phases = [
    { name: 'idle', ms: 1000 },
    { name: 'capture', ms: 1500 },
    { name: 'posted', ms: 1400 },
    { name: 'details', ms: 2600 },
    { name: 'redact', ms: 1500 },
    { name: 'redacted', ms: 1600 },
    { name: 'leave', ms: 600 },
    { name: 'reset', ms: 300 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: CoverCaption<Phase>[] = [
    { text: 'A new comment takes a screenshot of the spot.', phases: ['idle', 'capture', 'posted'] },
    { text: 'Members see the browser, system and screen it was left from.', phases: ['details'] },
    { text: 'Redact screenshot covers what should not be in it.', phases: ['redact', 'redacted', 'leave', 'reset'] }
];

const tiles: DeviceTile[] = [
    { key: 'input', icon: 'touch', label: 'Input', value: 'Touch' },
    { key: 'colorScheme', icon: 'light', label: 'Theme', value: 'Light' },
    { key: 'reducedMotion', icon: 'motion', label: 'Motion', value: 'Standard' },
    { key: 'pageLanguage', icon: 'language', label: 'Language', value: 'en' }
];

export function ScreenshotsCover() {
    return (
        <FeatureCover
            name="screenshots"
            phases={phases}
            captions={captions}
            stillPhase="redacted"
            stillCaption="A comment with its screenshot and the phone it was left from; Redact screenshot covers a name in it."
            className="h-[520px] min-h-[520px] md:h-[440px] md:min-h-[440px]">
            {phase => <Scene phase={phase} />}
        </FeatureCover>
    );
}

/**
 * The booking page on the phone, and the same part of it in the screenshot: the screenshot leaves the
 * review layer out, so it has no pin. `redaction` draws Redact screenshot's opaque box over the name.
 */
function BookingCard({ pinned, redaction }: { pinned?: boolean; redaction?: 'none' | 'drawing' | 'drawn' }) {
    return (
        <div className="flex flex-col gap-2 rounded-xl border bg-background p-3 text-left">
            <span className="text-sm font-semibold tracking-[-0.01em]">Your table is booked</span>
            <span className="relative w-max text-xs">
                Ana Novak · 2 guests
                {redaction && (
                    <span className={cx(
                        'absolute -inset-x-1 -inset-y-0.5 origin-left rounded-[2px] bg-[hsl(var(--brand-draw-ink))]',
                        redaction === 'drawing' && 'transition-[scale] duration-500 ease-out motion-reduce:transition-none',
                        redaction === 'none' ? 'scale-x-0' : 'scale-x-100'
                    )} />
                )}
            </span>
            <span className="text-xs text-muted-foreground">Saturday, 19:30</span>
            <div className="relative mt-1 h-16 rounded-md bg-muted">
                <span className="absolute inset-x-0 top-[45%] h-1.5 bg-background" />
                <span className="absolute inset-y-0 left-[60%] w-1.5 bg-background" />
                <span className="absolute left-[38%] top-[22%] size-2 rounded-full bg-foreground" />
            </div>
            <span className="relative inline-flex h-7 items-center justify-center rounded-md bg-primary text-xs font-medium text-primary-foreground">
                Open in maps
                {pinned !== undefined && <Pin number={18} size={20} className={cx('absolute left-[64%] top-[45%]', appear(pinned))} />}
            </span>
        </div>
    );
}

function Scene({ phase }: { phase: Phase }) {
    const is = (...names: Phase[]) => names.includes(phase);
    const writing = is('idle', 'capture');
    const posted = is('posted', 'details', 'redact', 'redacted');
    const redacting = is('redact', 'redacted');

    return (
        <div className="relative mx-auto flex h-full max-w-[760px] items-start justify-center gap-10 px-4 pt-6 sm:items-center sm:pt-0 md:justify-between md:px-10">
            {/* The phone the comment is left from; on narrow screens the thread alone */}
            <div className="relative hidden h-[360px] w-[210px] shrink-0 flex-col gap-3 rounded-[28px] border bg-background p-3 pt-5 sm:flex">
                <span className="mx-auto h-1 w-12 rounded-full bg-muted" />
                <span className="px-1 text-xs font-semibold">Trattoria</span>
                <div className="relative">
                    <BookingCard pinned={!is('idle', 'capture', 'reset')} />
                    {/* The part of the page the screenshot takes, outlined while it is taken */}
                    <span className={cx('absolute -inset-1.5 rounded-lg outline-2 outline-dashed outline-[hsl(var(--brand-accent))]', appear(is('capture')))} />
                </div>
            </div>

            <div className="relative h-[400px] w-full max-w-[340px] sm:h-[360px]">
                {/* The new comment and then its thread, in one place */}
                <div className="grid">
                    <Card className={cx('col-start-1 row-start-1 gap-2.5 self-start p-3', fade(writing))}>
                        <span className="text-[13px] font-semibold">New comment</span>
                        <div className="flex flex-col gap-2 rounded-lg border p-2.5">
                            <span className="text-[13px] leading-5">The map does not open in the maps app.</span>
                            <span className="flex items-center gap-1 text-muted-foreground">
                                <span className="inline-flex size-6 items-center justify-center"><PaperclipIcon size={14} strokeWidth={1.75} /></span>
                                {/* Attach screenshot, pressed: ink, with a check and a camera */}
                                <span className="inline-flex h-6 items-center gap-0.5 rounded-md bg-primary px-1.5 text-primary-foreground">
                                    <CheckIcon size={12} strokeWidth={2} /><CameraIcon size={14} strokeWidth={1.75} />
                                </span>
                                <SendIcon size={14} strokeWidth={1.75} className="ml-auto mr-1" />
                            </span>
                        </div>
                        {/* The toggle's status, as it is read out */}
                        <span className="grid text-[11px] text-muted-foreground">
                            <span className={cx('col-start-1 row-start-1', appear(!is('capture')))}>Taking a screenshot...</span>
                            <span className={cx('col-start-1 row-start-1', appear(is('capture')))}>A screenshot of this part of the page will be attached.</span>
                        </span>
                    </Card>
                    <Card className={cx('col-start-1 row-start-1 self-start pb-3', fade(posted))}>
                        <ThreadHeader stage="open" number={18} />
                        <div className="flex flex-col gap-2.5 px-3.5 pt-2.5">
                            <Message initials="MI" name="Mia" time={<TimeWithDevice />}>The map does not open in the maps app.</Message>
                            {/* The screenshot's thumbnail: the same part of the page, at half its size */}
                            <div className="ml-[34px] h-[112px] w-[156px] overflow-hidden rounded-md border bg-muted/50">
                                <div className="w-[312px] origin-top-left scale-50 p-3">
                                    <BookingCard redaction={is('redacted') ? 'drawn' : 'none'} />
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* The device details, opened from the icons after the time */}
                <Card className={cx('absolute left-4 top-[76px] z-10 w-[calc(100%-1rem)] max-w-[300px] gap-3 p-3', fade(is('details')))}>
                    <DeviceDetails
                        size="mobile"
                        screen="Mobile"
                        viewport="390×844 CSS px · 3x"
                        system={{ browser: 'Safari', os: 'iOS', browserLabel: 'Safari 26', osLabel: 'iOS 26' }}
                        tiles={tiles} />
                </Card>

                {/* The expanded screenshot in Redact screenshot: a box drawn over the name, then Save redaction */}
                <Card className={cx('absolute left-4 top-[76px] z-10 w-[calc(100%-1rem)] max-w-[300px] gap-3 p-3', fade(redacting))}>
                    <span className="text-[13px] font-semibold">Redact screenshot</span>
                    <BookingCard redaction={is('redact', 'redacted', 'leave') ? 'drawing' : 'none'} />
                    <span className="flex justify-end gap-1.5 text-xs font-medium">
                        <span className="inline-flex h-7 items-center rounded-md border px-2.5">Cancel</span>
                        <span className={cx('inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-primary-foreground transition-opacity duration-[120ms] ease-out', is('redacted') ? 'opacity-80' : 'opacity-100')}>Save redaction</span>
                    </span>
                </Card>
            </div>
        </div>
    );
}

/** The time of the first message, then the screen size and the browser it was left from (CommentDevice) */
function TimeWithDevice() {
    return (
        <span className="inline-flex items-center gap-1.5">
            just now
            <DeviceIcon name="mobile" size={12} />
            <BrowserMark name="Safari" size={12} />
        </span>
    );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
    return <div className={cx('flex flex-col rounded-xl border bg-popover text-popover-foreground', floating, className)}>{children}</div>;
}
