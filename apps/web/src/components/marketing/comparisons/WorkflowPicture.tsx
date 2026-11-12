import { ArrowRight, Check, FileText, ListChecks, MessageSquare, MousePointer2, Play, Terminal } from 'lucide-react';
import { Pin } from '@uier/brand/Pin';
import { StatusBadge } from '../LandingSpecimens';

export type WorkflowKind = 'review' | 'board' | 'diagnostics' | 'discovery' | 'proofing';

// Conceptual workflow illustrations, not screenshots or replicas of competitors' interfaces.
// The captions outside the picture state the capabilities; the illustration repeats no unique claims.
export function WorkflowPicture({ kind }: { kind: WorkflowKind }) {
    return <div aria-hidden="true" className="flex h-52 items-center justify-center overflow-hidden border-b bg-muted/50 p-5">
        {kind === 'review' ? <div className="flex w-full max-w-80 flex-col gap-4">
            <div className="relative rounded-xl border bg-background p-4">
                <span className="text-sm font-medium">A table for everyone</span>
                <div className="mt-3 h-2 w-3/4 rounded-full bg-muted" />
                <div className="mt-2 h-2 w-1/2 rounded-full bg-muted" />
                <Pin number={12} size={28} className="absolute right-5 top-7" />
                <MousePointer2 size={18} strokeWidth={1.75} className="absolute right-3 top-14" />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl border bg-background p-3 text-xs">
                <span>Check the fix</span><StatusBadge stage="ready" />
            </div>
        </div> : kind === 'diagnostics' ? <div className="w-full max-w-80 rounded-xl border bg-background">
            <div className="flex items-center gap-2 border-b p-3 text-xs font-medium"><Play size={16} strokeWidth={1.75} />Reproduce the problem</div>
            <div className="flex h-12 items-center gap-1.5 px-4">{[3, 5, 2, 7, 4, 6, 3, 8, 5, 4, 7, 2].map((height, index) => <span key={index} className="w-3 rounded-sm bg-foreground/60" style={{ height: height * 3 }} />)}</div>
            <div className="flex items-center gap-2 border-t p-3 text-xs text-muted-foreground"><Terminal size={16} strokeWidth={1.75} />Console · network · browser</div>
        </div> : kind === 'board' ? <div className="grid w-full max-w-80 grid-cols-3 overflow-hidden rounded-xl border bg-background">
            {['Report', 'Fix', 'Review'].map((name, index) => <div key={name} className="min-w-0 border-r p-2.5 last:border-0">
                <span className="text-xs font-medium">{name}</span>
                <div className="mt-3 flex h-20 flex-col gap-2 rounded-md border bg-muted/50 p-2"><MessageSquare size={16} strokeWidth={1.75} /><div className="h-1.5 rounded bg-border" /><div className="h-1.5 w-2/3 rounded bg-border" />{index === 2 && <Check size={16} strokeWidth={1.75} />}</div>
            </div>)}
        </div> : kind === 'proofing' ? <div className="flex w-full max-w-80 items-center justify-center gap-3">
            <div className="flex h-32 w-24 flex-col gap-3 rounded-xl border bg-background p-3"><FileText size={24} strokeWidth={1.75} /><div className="h-2 rounded bg-muted" /><div className="h-2 rounded bg-muted" /><div className="h-2 w-2/3 rounded bg-muted" /></div>
            <ArrowRight size={20} strokeWidth={1.75} />
            <div className="flex flex-col gap-3 rounded-xl border bg-background p-3 text-xs"><span>Version 2</span><span className="flex items-center gap-1.5"><Check size={16} strokeWidth={1.75} />Approved</span></div>
        </div> : <div className="flex w-full max-w-80 flex-col gap-3">
            <div className="rounded-xl border bg-background p-4"><span className="text-sm font-medium">How was your experience?</span><div className="mt-3 flex gap-2">{[1, 2, 3, 4, 5].map(value => <span key={value} className="flex size-8 items-center justify-center rounded-md border text-xs">{value}</span>)}</div></div>
            <div className="flex items-center gap-2 rounded-xl border bg-background p-3 text-xs"><ListChecks size={16} strokeWidth={1.75} />Requests → priorities → roadmap</div>
        </div>}
    </div>;
}
