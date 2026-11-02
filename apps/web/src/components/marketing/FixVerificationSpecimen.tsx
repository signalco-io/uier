import { cx } from '@signalco/ui-primitives/cx';
import { Pin } from '@uier/brand/Pin';
import { Avatar, floating } from './LandingSpecimens';

// A static picture of a thread waiting for its reviewer, for /features/fix-verification. Like the
// landing's specimens it is hidden from assistive technologies, the example content is an imaginary
// restaurant site, and the labels are the ones the thread shows (packages/toolbar CommentVerification).

/** The fixed spot on the example page, and its thread: Ready for review, with the reviewer's two choices */
export function FixVerificationSpecimen() {
    const hours = [['Monday to Friday', '12–23'], ['Saturday', '12–24'], ['Sunday', '12–22']];
    return (
        <div aria-hidden="true" className="flex justify-center overflow-hidden rounded-2xl border bg-muted/50 px-6 py-8">
            <div className="flex w-full max-w-[600px] items-center justify-between gap-8">
                <div className="hidden w-full max-w-[220px] flex-col sm:flex">
                    <span className="text-xl font-semibold tracking-[-0.015em]">Opening hours</span>
                    <div className="mt-3 flex flex-col text-sm">
                        {hours.map(([day, time]) => (
                            <span key={day} className="relative flex justify-between border-b py-1.5 tabular-nums">
                                <span>{day}</span>
                                <span className="text-muted-foreground">{time}</span>
                                {day === 'Sunday' && <Pin count={1} size={24} className="absolute left-[64%] top-[55%]" />}
                            </span>
                        ))}
                    </div>
                </div>
                <div className={cx('flex w-full max-w-[290px] shrink-0 flex-col rounded-xl border bg-popover text-popover-foreground', floating)}>
                    <div className="flex items-center gap-2 px-3.5 pt-3">
                        <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium">
                            <span className="size-1.5 rounded-full bg-[hsl(var(--brand-accent))]" />
                            Ready for review
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">#21</span>
                    </div>
                    <div className="flex flex-col gap-2 px-3.5 py-3">
                        <div className="flex items-center gap-2">
                            <Avatar initials="MI" />
                            <span className="text-[13px] font-medium">Mia</span>
                            <span className="font-mono text-[11px] text-muted-foreground">2d</span>
                        </div>
                        <span className="text-[13px] leading-5">We open on Sundays since May. Can this say 12–22?</span>
                    </div>
                    <div className="flex flex-col gap-2.5 border-t px-3.5 py-3 text-[13px] leading-5">
                        <span className="text-muted-foreground">Ready for review. Requested by Leo for Mia at 6 May 2026, 14:05 UTC.</span>
                        <span>Sunday hours updated on staging.</span>
                        <span className="self-start underline underline-offset-2">Open fix link</span>
                        <span className="flex flex-wrap gap-1.5 pt-1">
                            <span className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground">Confirm fix</span>
                            <span className="inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium">Still needs work</span>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
