import { BugIcon, ClipboardListIcon, SquareIcon } from 'lucide-react';

/** Conceptual review notes, not an automated score or a customer report. */
export function ReviewChecklistSpecimen() {
    return <div aria-hidden="true" className="w-full max-w-sm rounded-xl border bg-background">
        <div className="flex items-center gap-2 border-b p-4 text-sm font-medium"><ClipboardListIcon size={18} strokeWidth={1.75} />Review scope</div>
        <div className="flex flex-col gap-4 p-5">
            {['Content', 'Layout', 'Responsive', 'Interactions', 'Accessibility', 'Findings and handoff'].map(label => <div key={label} className="flex items-center gap-3 text-sm text-muted-foreground"><SquareIcon size={16} strokeWidth={1.75} /><span>{label}</span></div>)}
        </div>
    </div>;
}

/** A report's structure; no invented telemetry or automatic diagnostics. */
export function BugReportSpecimen() {
    return <div aria-hidden="true" className="w-full max-w-sm rounded-xl border bg-background">
        <div className="flex items-center gap-2 border-b p-4 text-sm font-medium"><BugIcon size={18} strokeWidth={1.75} />One observable problem</div>
        <div className="flex flex-col gap-4 p-5">
            {['Where it happened', 'Expected and actual', 'Steps to reproduce', 'Available evidence'].map(label => <div key={label} className="flex flex-col gap-2"><span className="text-xs text-muted-foreground">{label}</span><span className="h-2 w-4/5 rounded-full bg-muted" /></div>)}
        </div>
    </div>;
}
