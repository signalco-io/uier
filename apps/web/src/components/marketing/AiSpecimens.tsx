import { AI } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { Avatar, floating, Specimen } from './LandingSpecimens';

// Static pictures for the AI parts of uier: a coding agent working on a thread through the MCP
// connector, and rewrite suggestions in the toolbar. Like the landing's specimens they are hidden
// from assistive technologies and the example content is an imaginary restaurant site. The tool
// names are the connector's (src/lib/mcp/server.ts); the rewrite labels are the toolbar's
// (CommentBubble, RewriteSuggestions). The coding agent is generic, not any one product, and its
// approval question is the agent's own: uier does not show it.

/** The thread the agent reads: open, with where it was left */
function AgentThread() {
    return (
        <div className={cx('flex w-full max-w-[230px] flex-col rounded-xl border bg-popover text-popover-foreground', floating)}>
            <div className="flex items-center gap-2 px-3.5 pt-3">
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium">
                    <span className="size-1.5 rounded-full bg-foreground" />
                    Open
                </span>
                <span className="font-mono text-xs text-muted-foreground">#12</span>
            </div>
            <div className="flex flex-col gap-2 px-3.5 py-3">
                <div className="flex items-center gap-2">
                    <Avatar initials="MI" />
                    <span className="text-[13px] font-medium">Mia</span>
                    <span className="font-mono text-[11px] text-muted-foreground">1h</span>
                </div>
                <span className="text-[13px] leading-5">The booking button is hidden behind the menu on my phone.</span>
            </div>
            <div className="border-t px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground">/reservations · 390×844</div>
        </div>
    );
}

/** A coding agent's session: the request, the connector's tools it called, and the approval it waits for */
function AgentSession() {
    const steps: [string, string][] = [
        ['list_feedback', '1 open on /reservations'],
        ['get_feedback', '#12 with its screenshot'],
        ['Edited', 'Reservations.tsx']
    ];
    return (
        <div className={cx('flex w-full max-w-[300px] shrink-0 flex-col rounded-xl border bg-background', floating)}>
            <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
                <span className="text-xs font-medium text-muted-foreground">Coding agent</span>
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium">
                    <span className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />
                    uier
                </span>
            </div>
            <div className="flex flex-col gap-1 px-3.5 py-3 font-mono text-[11px] leading-4">
                <span className="truncate">&gt; Fix uier #12</span>
                {steps.map(([step, detail]) => (
                    <span key={step} className="truncate">
                        <span className="text-foreground">{step}</span>
                        <span className="text-muted-foreground"> {detail}</span>
                    </span>
                ))}
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-3.5 py-2.5">
                <span className="text-xs">Reply and mark it done?</span>
                <span className="flex shrink-0 gap-1">
                    <span className="inline-flex h-6 items-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground">Yes</span>
                    <span className="inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium">No</span>
                </span>
            </div>
        </div>
    );
}

/** The thread beside the agent working on it */
function AgentScene() {
    return (
        <div className="flex w-full max-w-[600px] items-center justify-between gap-8">
            <div className="hidden w-full sm:flex">
                <AgentThread />
            </div>
            <AgentSession />
        </div>
    );
}

/** The landing's feature tile */
export function AgentSpecimen() {
    return (
        <Specimen className="items-center">
            <AgentScene />
        </Specimen>
    );
}

/** /features/ai: the same scene on its own */
export function CodingAgentSpecimen() {
    return (
        <div aria-hidden="true" className="flex justify-center overflow-hidden rounded-2xl border bg-muted/50 px-6 py-8">
            <AgentScene />
        </div>
    );
}

/** Selected text on the example page, and the rewrite with its suggestions */
export function RewriteSpecimen() {
    const suggestions = ['The kitchen is open late, every night.', 'We cook until late, seven nights a week.'];
    return (
        <div aria-hidden="true" className="flex justify-center overflow-hidden rounded-2xl border bg-muted/50 px-6 py-8">
            <div className="flex w-full max-w-[600px] items-center justify-between gap-8">
                <div className="hidden w-full max-w-[220px] flex-col gap-3 sm:flex">
                    <span className="text-xl font-semibold tracking-[-0.015em]">Late dinner</span>
                    <span className="text-sm leading-6 text-muted-foreground">
                        <span className="rounded-[3px] bg-[hsl(var(--brand-selection))] text-foreground">Our kitchen stays open until late in the evening on every single night of the week.</span>
                    </span>
                </div>
                <div className={cx('flex w-full max-w-[300px] shrink-0 flex-col rounded-xl border bg-popover text-popover-foreground', floating)}>
                    <div className="flex flex-col gap-2 px-3.5 py-3">
                        <span className="text-xs font-medium text-muted-foreground">Suggested text</span>
                        <span className="rounded-md border px-2.5 py-2 text-[13px] leading-5">The kitchen is open late, every night.</span>
                    </div>
                    <div className="flex flex-col gap-2 border-t px-3.5 py-3">
                        <span className="flex gap-1.5">
                            <span className="inline-flex h-7 min-w-0 flex-1 items-center rounded-md border px-2.5 text-xs text-muted-foreground">Shorter</span>
                            <span className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium">
                                <AI size={14} />
                                Suggest
                            </span>
                        </span>
                        {suggestions.map(suggestion => (
                            <span key={suggestion} className="rounded-md border px-2.5 py-1.5 text-xs leading-4">{suggestion}</span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
