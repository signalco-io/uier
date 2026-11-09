import { agentMarks, type AgentKind } from '../agents';

/** An AI agent's one-colour logo in the text colour, as in the app (`@uier/toolbar/agents`). Decorative: its name is beside it. */
export function AgentMark({ kind, size = 14 }: { kind: AgentKind; size?: number }) {
    const mark = agentMarks[kind];
    return <svg aria-hidden="true" data-agent-mark={kind} viewBox="0 0 24 24" width={size} height={size} focusable="false" className="shrink-0" fill={mark.stroke ? 'none' : 'currentColor'}
        {...(mark.stroke ? { stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } : {})}>
        {mark.paths.map(d => <path key={d} d={d} />)}
    </svg>;
}
