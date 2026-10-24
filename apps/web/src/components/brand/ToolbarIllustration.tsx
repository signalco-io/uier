import { PIN_PATH, PIN_VIEWBOX } from '@uier/brand';

// A static picture of the review toolbar (packages/toolbar renders the real one).
export function ToolbarIllustration() {
    const icon = 'inline-flex size-11 items-center justify-center rounded-full text-white';
    return (
        <div
            role="img"
            aria-label="The review toolbar: add comment, inbox with two unread, exit review"
            className="inline-flex items-center gap-0.5 rounded-full bg-black p-1 shadow-[0_0_0_1px_#262626,0_8px_24px_rgba(0,0,0,0.16)]">
            <span className={`${icon} bg-neutral-800`}>
                <svg viewBox={PIN_VIEWBOX} width="24" height="24" fill="none" aria-hidden="true"><path d={PIN_PATH} stroke="currentColor" strokeWidth="1.75" /><path d="M9 16h14M16 9v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className={`${icon} relative`}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
                <span className="absolute right-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--brand-accent))] px-1 text-[10px] font-semibold text-white">2</span>
            </span>
            <span className="mx-1 h-6 w-px bg-neutral-800" />
            <span className={icon}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </span>
        </div>
    );
}
