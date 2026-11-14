import { AI, Send } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { GitPullRequestIcon } from 'lucide-react';
import { AssigneeAvatar, floating, Message, Specimen, ThreadHeader } from './LandingSpecimens';

// Static pictures for the AI parts of uier: a coding agent working on a thread through the MCP
// connector (attached to the thread as the assignee's agent, its pull request linked), and rewrite suggestions in the toolbar. Like the landing's specimens they are hidden
// from assistive technologies and the example content is an imaginary restaurant site. The tool
// names are the connector's (src/lib/mcp/server.ts); the rewrite labels are the toolbar's
// (CommentBubble, RewriteSuggestions). The coding agent is generic, not any one product, and its
// approval question is the agent's own: uier does not show it.

/** The thread the agent works on: In progress, its assignee with the agent stacked on their avatar, the linked pull request */
function AgentThread() {
    return (
        <div className={cx('flex w-full max-w-[240px] flex-col rounded-xl border bg-popover text-popover-foreground', floating)}>
            <ThreadHeader stage="in-progress" number={12} assignees={<AssigneeAvatar initials="LE" agent />} />
            <div className="px-3.5 py-3">
                <Message initials="MI" name="Mia" time="1 hr ago">The booking button is hidden behind the menu on my phone.</Message>
            </div>
            <div className="flex items-center gap-2 border-t px-3.5 py-2.5 text-[11px] text-muted-foreground">
                <GitPullRequestIcon size={12} strokeWidth={1.75} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono">#318 Fix booking button</span>
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-foreground">
                    <span className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />
                    Open
                </span>
            </div>
        </div>
    );
}

/** A coding agent's session: the request, the connector's tools it called, and the approval it waits for */
function AgentSession() {
    const steps: [string, string][] = [
        ['get_feedback', '#12 with its screenshot'],
        ['set_feedback_agent', 'working on #12'],
        ['Edited', 'BookButton.tsx'],
        ['link_feedback_pull_request', '#318']
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
                <span className="text-xs">Reply and ask Mia to verify?</span>
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

/**
 * Selected text on the example page, and the rewrite form as the toolbar lays it out (composer-popovers.md,
 * "A rewrite"): the header, the quoted text, the instruction box with Suggest, the suggestions, then the
 * text box with the picked one and its send button, Post suggestion
 */
export function RewriteSpecimen() {
    const selected = 'Our kitchen stays open until late in the evening on every single night of the week.';
    const suggestions = ['The kitchen is open late, every night.', 'We cook until late, seven nights a week.'];
    return (
        <div aria-hidden="true" className="flex justify-center overflow-hidden rounded-2xl border bg-muted/50 px-6 py-8">
            <div className="flex w-full max-w-[600px] items-center justify-between gap-8">
                <div className="hidden w-full max-w-[220px] flex-col gap-3 sm:flex">
                    <span className="text-xl font-semibold tracking-[-0.015em]">Late dinner</span>
                    <span className="text-sm leading-6 text-muted-foreground">
                        <span className="rounded-[3px] bg-[hsl(var(--brand-selection))] text-foreground">{selected}</span>
                    </span>
                </div>
                <div className={cx('flex w-full max-w-[300px] shrink-0 flex-col gap-2.5 rounded-xl border bg-popover p-3 text-popover-foreground', floating)}>
                    <span className="text-xs font-medium">New rewrite suggestion</span>
                    <span className="truncate rounded-r-md border-l-2 border-tertiary bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{selected}</span>
                    <span className="flex h-8 items-center gap-1.5 rounded-lg border pl-2 pr-1 text-xs">
                        <AI size={14} className="shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">Shorter</span>
                        <span className="inline-flex h-6 items-center rounded-md px-2 font-medium">Suggest</span>
                    </span>
                    {suggestions.map((suggestion, index) => (
                        <span key={suggestion} className={cx('rounded-md border px-2.5 py-1.5 text-xs leading-4', index === 0 && 'border-foreground/40 bg-muted/60')}>{suggestion}</span>
                    ))}
                    {/* The text box: the picked suggestion, Post suggestion as its send button (Enter sends) */}
                    <span className="flex items-end gap-2 rounded-lg border p-2.5">
                        <span className="min-w-0 flex-1 text-[13px] leading-5">The kitchen is open late, every night.</span>
                        <Send size={16} className="shrink-0 text-muted-foreground" />
                    </span>
                </div>
            </div>
        </div>
    );
}
