'use client';

import { cx } from '@signalco/ui-primitives/cx';
import { GitPullRequestIcon } from 'lucide-react';
import { AssigneeAvatar, floating, Message, ThreadHeader, type Stage } from '../LandingSpecimens';
import { appear, fade, FeatureCover, type CoverCaption } from './FeatureCover';

// /features/ai: a coding agent working on thread #12 through the MCP connector. Its session calls the
// connector's tools one at a time (their names are src/lib/mcp/server.ts's), the thread shows the agent
// under its assignee and In progress, the agent edits the code, asks its own approval question (the coding
// tool's, not uier's), then links the pull request and requests verification, and the thread goes to Ready
// to verify with the pull request under it. The agent is generic, not any one product, like the page's
// other pictures (AiSpecimens); recheck with docs/mcp.md.

const phases = [
    { name: 'idle', ms: 1100 },
    { name: 'read', ms: 1400 },
    { name: 'working', ms: 1500 },
    { name: 'edit', ms: 1200 },
    { name: 'approve', ms: 1700 },
    { name: 'report', ms: 2200 },
    { name: 'leave', ms: 600 },
    { name: 'reset', ms: 300 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: CoverCaption<Phase>[] = [
    { text: 'Your agent reads the thread with its page, anchor and screenshot.', phases: ['idle', 'read'] },
    { text: 'The thread shows that your coding tool is working on it.', phases: ['working', 'edit'] },
    { text: 'When you approve, it links its pull request and asks the reviewer to verify.', phases: ['approve', 'report', 'leave', 'reset'] }
];

/** The session's lines, each shown from its phase on */
const lines: { tool: string; detail: string; from: Phase }[] = [
    { tool: 'get_feedback', detail: '#12 with its screenshot', from: 'read' },
    { tool: 'set_feedback_agent', detail: 'working on #12', from: 'working' },
    { tool: 'Edited', detail: 'BookButton.tsx', from: 'edit' },
    { tool: 'link_feedback_pull_request', detail: '#318', from: 'report' },
    { tool: 'request_feedback_verification', detail: 'Mia', from: 'report' }
];

const order = phases.map(phase => phase.name);

export function AgentCover() {
    return (
        <FeatureCover
            name="ai"
            phases={phases}
            captions={captions}
            stillPhase="report"
            stillCaption="A coding agent’s session beside the thread it fixed: its pull request linked and the fix waiting for the reviewer."
            className="h-[540px] min-h-[540px] md:h-[400px] md:min-h-[400px]">
            {phase => <Scene phase={phase} />}
        </FeatureCover>
    );
}

function Scene({ phase }: { phase: Phase }) {
    const is = (...names: Phase[]) => names.includes(phase);
    const reached = (from: Phase) => order.indexOf(phase) >= order.indexOf(from) && !is('leave', 'reset');
    const working = reached('working');
    const reported = reached('report');
    const stage: Stage = reported ? 'ready' : working ? 'in-progress' : 'open';

    return (
        <div className="relative mx-auto flex h-full max-w-[820px] flex-col items-center gap-5 px-4 pt-6 md:flex-row md:items-center md:justify-between md:gap-10 md:px-10 md:pt-0">
            {/* The thread the agent works on: its assignee with the agent on their avatar, then the pull request */}
            <div className={cx('flex w-full max-w-[300px] flex-col rounded-xl border bg-popover text-popover-foreground', floating)}>
                <ThreadHeader stage={stage} number={12} assignees={<AssigneeAvatar initials="LE" agent={working} />} />
                <div className="px-3.5 py-3">
                    <Message initials="MI" name="Mia" time="1 hr ago">The booking button is hidden behind the menu on my phone.</Message>
                </div>
                <div className={cx('grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none', reported ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                    <div className="min-h-0 overflow-hidden">
                        <div className={cx('flex items-center gap-2 border-t px-3.5 py-2.5 text-[11px] text-muted-foreground', fade(reported))}>
                            <GitPullRequestIcon size={12} strokeWidth={1.75} className="shrink-0" />
                            <span className="min-w-0 flex-1 truncate font-mono">#318 Fix booking button</span>
                            <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-foreground">
                                <span className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />
                                Open
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* The coding agent's session: the request, the connector's tools it called, and its own approval question */}
            <div className={cx('flex w-full max-w-[340px] shrink-0 flex-col rounded-xl border bg-background', floating)}>
                <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
                    <span className="text-xs font-medium text-muted-foreground">Coding agent</span>
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium">
                        <span className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />
                        uier
                    </span>
                </div>
                <div className="flex h-[132px] flex-col gap-1 px-3.5 py-3 font-mono text-[11px] leading-4">
                    <span className="truncate">&gt; Fix uier #12</span>
                    {lines.map(line => (
                        <span key={line.tool} className={cx('truncate', fade(reached(line.from)))}>
                            <span className="text-foreground">{line.tool}</span>
                            <span className="text-muted-foreground"> {line.detail}</span>
                        </span>
                    ))}
                </div>
                <div className={cx('flex items-center justify-between gap-2 border-t px-3.5 py-2.5', appear(is('approve', 'report')))}>
                    <span className="text-xs">Link the pull request and ask Mia to verify?</span>
                    <span className="flex shrink-0 gap-1">
                        <span className={cx('inline-flex h-6 items-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-opacity duration-[120ms] ease-out', is('report') && 'opacity-60')}>Yes</span>
                        <span className="inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium">No</span>
                    </span>
                </div>
            </div>
        </div>
    );
}
