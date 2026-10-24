import { Avatar } from '@signalco/ui-primitives/Avatar';
import { Typography } from '@signalco/ui-primitives/Typography';

// A static example of an open comment thread, as the review layer shows it on a page.
// Threads follow the system theme (paper in light, surface in dark); see BRAND.md.
export function ReviewThreadDemo() {
    return (
        <div className="flex flex-col gap-2.5">
            <div
                role="group"
                aria-label="Example comment thread"
                className="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.08)] dark:shadow-none">
                <div className="flex flex-col gap-3.5 px-4 py-3.5">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Avatar size="sm">M</Avatar>
                            <span className="text-[13px] font-medium">Mia</span>
                            <span className="font-mono text-[11px] text-muted-foreground">2h</span>
                        </div>
                        <div className="rounded-r-md border-l-2 border-tertiary bg-muted px-2.5 py-0.5 text-[13px] text-muted-foreground">on the page.</div>
                        <Typography level="body2">Will first-time visitors get what “the page” means before they scroll? “on the site” might land faster.</Typography>
                        <span className="font-mono text-[10px] text-muted-foreground">Chrome 142 · 1440×900 · macOS</span>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Avatar size="sm">J</Avatar>
                            <span className="text-[13px] font-medium">Jon</span>
                            <span className="font-mono text-[11px] text-muted-foreground">35m</span>
                        </div>
                        <Typography level="body2">The line right under it says “live website”. Keeping it, it is the whole point.</Typography>
                    </div>
                </div>
                <div className="h-px bg-border" />
                <div className="flex items-center gap-2 py-2 pl-3 pr-2">
                    <span className="flex-1 text-sm text-muted-foreground">Leave a comment…</span>
                    <span aria-hidden="true" className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                    </span>
                </div>
            </div>
            <Typography level="body3" tertiary className="px-1">A thread, open right where the comment was left. This one is on the headline.</Typography>
        </div>
    );
}
