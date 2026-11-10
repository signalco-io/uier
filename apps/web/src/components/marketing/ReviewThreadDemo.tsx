import { ExpandDown } from '@signalco/ui-icons';
import { Avatar } from '@signalco/ui-primitives/Avatar';
import { Typography } from '@signalco/ui-primitives/Typography';

// A static example of an open comment thread, as the review layer shows it on a page: guest names
// with their code as the avatar, "You" for your own messages, and the quoted text of a text comment,
// under the thread's header and above the reply box.
// Threads follow the system theme (paper in light, surface in dark); see BRAND.md.
export function ReviewThreadDemo() {
    return (
        <div className="flex flex-col gap-2.5">
            <div
                role="group"
                aria-label="Example comment thread"
                className="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.08)] dark:shadow-none">
                {/* The thread's header (packages/toolbar CommentThreadHeader): the status menu and the number */}
                <div aria-hidden="true" className="flex items-center gap-2 px-4 pt-3.5">
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium">
                        <span className="size-1.5 rounded-full border border-foreground" />
                        Open
                        <ExpandDown size={12} className="text-muted-foreground" />
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">#1</span>
                </div>
                <div className="flex flex-col gap-3.5 px-4 py-3.5">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Avatar size="sm" aria-hidden="true" className="font-semibold">3F</Avatar>
                            <span className="text-[13px] font-medium">Guest 3F2A</span>
                            <span className="font-mono text-[11px] text-muted-foreground">2h</span>
                        </div>
                        <div className="rounded-r-md border-l-2 border-tertiary bg-muted px-2.5 py-0.5 text-[13px] text-muted-foreground">on the page.</div>
                        <Typography level="body2">Will first-time visitors get what “the page” means before they scroll? “on the site” might land faster.</Typography>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Avatar size="sm" aria-hidden="true" className="font-semibold">9C</Avatar>
                            <span className="text-[13px] font-medium">You</span>
                            <span className="font-mono text-[11px] text-muted-foreground">35m</span>
                        </div>
                        <Typography level="body2">The line right under it says “live website”. Keeping it, it is the whole point.</Typography>
                    </div>
                </div>
                {/* The reply box: one bordered box with the send button, a plain icon since Enter sends */}
                <div className="mx-3 mb-3 flex items-center gap-2 rounded-md border py-1.5 pl-3 pr-1.5">
                    <span className="flex-1 text-sm text-muted-foreground">Reply...</span>
                    <span aria-hidden="true" className="inline-flex size-7 items-center justify-center text-muted-foreground">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                    </span>
                </div>
            </div>
            <Typography level="body3" tertiary className="px-1">A thread, open right where the comment was left. This one is on the headline.</Typography>
        </div>
    );
}
