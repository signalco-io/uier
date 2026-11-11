'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useAgentWorking } from '@uier/toolbar/agent-working';
import { toast } from 'sonner';
import { PlusIcon } from 'lucide-react';
import {
    assigneeAgents, commentAssignees, agentKinds, agentLabels, MAX_AGENT_MODEL_LENGTH, MAX_AGENT_REASONING_LENGTH, MAX_AGENT_SESSION_LENGTH, MAX_AGENT_SESSION_URL_LENGTH, agentSessionLink, agentModelText, modelName, reasoningText, type AgentKind, type AssigneeAgentView
} from '@uier/toolbar/agents';
import { Button } from '@/src/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { cn } from '@/src/lib/utils';
import type { ProjectAssignee, ProjectCommentView } from '../../../lib/app/projectComments';
import type { AssigneeAgentInput } from '../../../lib/review/assigneeAgentModel';
import { setCommentAgentAction } from './actions';
import { AgentAvatar } from './AgentAvatar';
import { AgentSessionLink } from './AgentSessionLink';
import { AgentDetailsItem } from './AssigneeCard';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import { hoverPopoverTrigger } from '../hoverPopover';
import { useCommentUpdate } from './CommentUpdates';

function agentView(input: AssigneeAgentInput): AssigneeAgentView {
    const model = input.model?.trim();
    const reasoning = input.reasoning?.trim();
    const sessionId = input.sessionId?.trim();
    const sessionLink = agentSessionLink(input.sessionUrl);
    return { ...(sessionLink ? { sessionUrl: sessionLink.url } : {}), kind: input.kind, label: agentLabels[input.kind], ...(model ? { model } : {}), ...(reasoning ? { reasoning } : {}), ...(sessionId ? { sessionId } : {}) };
}

/**
 * The model by name after the agent's ("Opus 5.5" after Claude; the reported id on hover) and its reasoning
 * level after a dot ("· xhigh", named "xhigh reasoning"), each truncated on narrow screens. A model id the
 * names do not know shows as it is, in mono (BRAND.md: mono means machine).
 */
function AgentDetails({ agent }: { agent: AssigneeAgentView }) {
    const { t } = useAppI18n();
    const known = agent.model ? modelName(agent.model) !== undefined : false;
    return <>
        {agent.model && (
            <span data-agent-model="" title={agent.model} className={cn('min-w-0 truncate', !known && 'font-mono text-xs text-muted-foreground')}>
                {agentModelText({ label: agent.label, model: agent.model })}
            </span>
        )}
        {agent.reasoning && <>
            <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">·</span>
            <span data-agent-reasoning="" title={t("{level} reasoning", { level: agent.reasoning })} className="min-w-0 truncate text-xs text-muted-foreground">{agent.reasoning}</span>
            <span className="sr-only">{t("reasoning")}</span>
        </>}
    </>;
}

/**
 * The AI agent working under the assignee, after their name in the thread's Assignee field. The assignee
 * picks it (Claude, Codex, ChatGPT, Cursor or AI agent), shown by its logo and name, edits its session id, model and reasoning level (agents usually
 * report these themselves through MCP) or removes it; everyone else reads "with Claude". Its details and desktop session
 * link ("Open in T3 Code") show only once the chip is clicked: at the top of the assignee's menu, or in a popover like the
 * assignee card's for everyone else.
 */
export function AgentControl({ projectId, comment, assignee, editable }: { projectId: string; comment: ProjectCommentView; assignee: ProjectAssignee; editable: boolean }) {
    const agents = assigneeAgents(assignee);
    return <span className="flex min-w-0 flex-wrap items-center gap-1">
        {agents.map((agent, index) => <SingleAgentControl key={agent.id ?? index} projectId={projectId} comment={comment} assignee={assignee} agent={agent} editable={editable} />)}
        {editable && agents.length < 10 && <SingleAgentControl projectId={projectId} comment={comment} assignee={assignee} editable adding={agents.length > 0} />}
    </span>;
}

function SingleAgentControl({ projectId, comment, assignee, agent, editable, adding = false }: { projectId: string; comment: ProjectCommentView; assignee: ProjectAssignee; agent?: AssigneeAgentView; editable: boolean; adding?: boolean }) {
    const { t } = useAppI18n();
    const [pending, start] = useTransition();
    const update = useCommentUpdate();
    const attempt = useRef<{ value: string; key: string } | null>(null);
    const [editing, setEditing] = useState(false);
    const [details, setDetails] = useState({ sessionId: '', sessionUrl: '', model: '', reasoning: '' });
    const [error, setError] = useState<string>();
    const trigger = useRef<HTMLButtonElement>(null);
    const ids = useId();

    const working = useAgentWorking(agent?.workingUntil);
    const sessionLink = agentSessionLink(agent?.sessionUrl);

    if (!editable) {
        if (!agent) return null;
        return (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                <span className="text-muted-foreground">{t("with")}</span>
                <Popover>
                    <PopoverTrigger {...hoverPopoverTrigger} render={<Button variant="ghost" size="sm"
                        aria-description={working ? t("{value0} is working now", { value0: agent.label }) : undefined}
                        className="h-7 min-w-0 max-w-full gap-1.5 px-1.5 font-normal pointer-coarse:min-h-11" />}>
                        <AgentAvatar kind={agent.kind} workingUntil={agent.workingUntil} className="size-4" />
                        <span className="shrink-0">{t(agent.label)}</span>
                        <AgentDetails agent={agent} />
                    </PopoverTrigger>
                    <PopoverContent align="start" aria-label={t("{agent} details", { agent: agent.label })} className="w-72 p-2">
                        <AgentDetailsItem agent={agent} />
                    </PopoverContent>
                </Popover>
            </span>
        );
    }

    /** One key per intended change, reused when the same change is retried */
    const save = async (next: AssigneeAgentInput | null) => {
        const value = JSON.stringify(next);
        if (attempt.current?.value !== value) attempt.current = { value, key: crypto.randomUUID() };
        const previous = commentAssignees(comment);
        const agents = assigneeAgents(assignee);
        const nextAgents = agent ? agents.flatMap(item => item === agent ? next ? [{ ...agentView(next), id: agent.id }] : [] : [item])
            : [...agents, ...(next ? [agentView(next)] : [])];
        const people = previous.map(person => person.id === assignee.id ? { ...person, agents: nextAgents, agent: nextAgents[0] } : person);
        update({ id: comment.id, patch: { assignees: people, assignee: people[0] } });
        const rollback = () => update({ id: comment.id, patch: { assignees: previous, assignee: previous[0] } });
        try {
            const result = await setCommentAgentAction(projectId, comment.id, next, attempt.current.key, agent?.id, adding);
            if (!result?.ok) { rollback(); return result?.error ?? t("Could not change the agent. Try again."); }
            attempt.current = null;
            return undefined;
        } catch { rollback(); return t("Could not change the agent. Try again."); }
    };
    const choose = (kind: AgentKind) => start(async () => {
        if (kind === agent?.kind) return;
        const failed = await save({ kind });
        if (failed) toast.error(failed);
    });
    const remove = () => start(async () => {
        const failed = await save(null);
        if (failed) toast.error(failed);
    });
    const openDetails = () => {
        setDetails({ sessionUrl: agent?.sessionUrl ?? '', sessionId: agent?.sessionId ?? '', model: agent?.model ?? '', reasoning: agent?.reasoning ?? '' });
        setError(undefined);
        setEditing(true);
    };
    const saveDetails = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!agent) return;
        if (details.sessionUrl && !agentSessionLink(details.sessionUrl)) { setError(t("Use a supported desktop session link.")); return; }
        start(async () => {
            const failed = await save({ kind: agent.kind, sessionId: details.sessionId, sessionUrl: details.sessionUrl, model: details.model, reasoning: details.reasoning });
            if (failed) { setError(failed); return; }
            setEditing(false);
        });
    };

    return (
        <>
            {agent && <span aria-hidden="true" className="text-muted-foreground">{t("with")}</span>}
            <DropdownMenu>
                <DropdownMenuTrigger ref={trigger} render={<Button variant="ghost" size="sm" disabled={pending}
                    aria-label={agent ? t("Agent: {value0}. Change agent", { value0: agent.label }) : undefined}
                    aria-description={working && agent ? t("{value0} is working now", { value0: agent.label }) : undefined}
                    className={agent ? 'h-7 min-w-0 max-w-full gap-1.5 px-1.5 font-normal pointer-coarse:min-h-11' : 'h-7 gap-1 px-1.5 font-normal text-muted-foreground hover:text-foreground pointer-coarse:min-h-11'} />}>
                    {agent ? <>
                        <AgentAvatar kind={agent.kind} workingUntil={agent.workingUntil} className="size-4" />
                        <span className="shrink-0">{t(agent.label)}</span>
                        <AgentDetails agent={agent} />
                        {pending && <Spinner data-icon="inline-end" />}
                    </> : <>
                        {pending ? <Spinner data-icon="inline-start" /> : <PlusIcon aria-hidden="true" data-icon="inline-start" />}
                        {t("Add agent")}
                    </>}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className={agent ? 'w-72' : 'min-w-52'}>
                    {agent && <>
                        {/* The agent's details, as on the assignee card; its desktop session link is a menu item below them */}
                        <AgentDetailsItem agent={agent} sessionLink={false} className="px-1.5 py-1" />
                        {sessionLink && <DropdownMenuItem className="pointer-coarse:min-h-11" render={<a href={sessionLink.url} />}>
                            {t("Open in ")}{sessionLink.app}
                        </DropdownMenuItem>}
                        <DropdownMenuSeparator />
                    </>}
                    <DropdownMenuGroup>
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("Agent working with you")}</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={agent?.kind ?? ''}>
                            {agentKinds.map(kind => (
                                <DropdownMenuRadioItem key={kind} value={kind} closeOnClick className="pointer-coarse:min-h-11" onClick={() => choose(kind)}>
                                    <AgentAvatar kind={kind} />
                                    {t(agentLabels[kind])}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                    {agent && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="pointer-coarse:min-h-11" onClick={openDetails}>{t("Session and model")}</DropdownMenuItem>
                            <DropdownMenuItem className="pointer-coarse:min-h-11" onClick={remove}>{t("Remove agent")}</DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={editing} onOpenChange={open => { if (!pending) setEditing(open); }}>
                <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" finalFocus={trigger}>
                    <form onSubmit={saveDetails} className="flex flex-col gap-6">
                        <DialogHeader>
                            <DialogTitle>{t("{agent} details", { agent: agent?.label ?? t("Agent") })}</DialogTitle>
                            <DialogDescription>{t("Agents usually fill these in when they start. Change them only when they are missing or wrong.")}</DialogDescription>
                        </DialogHeader>
                        <FieldGroup>
                            <Field>
                                <FieldLabel htmlFor={`${ids}-session`}>{t("Session id")}</FieldLabel>
                                <Input id={`${ids}-session`} value={details.sessionId} maxLength={MAX_AGENT_SESSION_LENGTH} autoComplete="off" spellCheck={false}
                                    className="font-mono" onChange={event => setDetails(current => ({ ...current, sessionId: event.target.value }))} />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor={`${ids}-session-url`}>{t("Session link")}</FieldLabel>
                                <Input id={`${ids}-session-url`} value={details.sessionUrl} maxLength={MAX_AGENT_SESSION_URL_LENGTH} autoComplete="off" spellCheck={false}
                                    aria-describedby={`${ids}-session-url-description`} className="font-mono"
                                    onChange={event => setDetails(current => ({ ...current, sessionUrl: event.target.value }))} />
                                <FieldDescription id={`${ids}-session-url-description`}>{t("An existing T3 Code, Codex or Claude desktop session link, supplied by the agent.")}</FieldDescription>
                                <AgentSessionLink sessionUrl={details.sessionUrl} />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor={`${ids}-model`}>{t("Model")}</FieldLabel>
                                <Input id={`${ids}-model`} value={details.model} maxLength={MAX_AGENT_MODEL_LENGTH} autoComplete="off" spellCheck={false}
                                    className="font-mono" onChange={event => setDetails(current => ({ ...current, model: event.target.value }))} />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor={`${ids}-reasoning`}>{t("Reasoning level")}</FieldLabel>
                                <Input id={`${ids}-reasoning`} value={details.reasoning} maxLength={MAX_AGENT_REASONING_LENGTH} autoComplete="off" spellCheck={false}
                                    aria-describedby={`${ids}-reasoning-description`} className="font-mono"
                                    onChange={event => setDetails(current => ({ ...current, reasoning: event.target.value }))} />
                                <FieldDescription id={`${ids}-reasoning-description`}>{t("As the agent names it, for example high or xhigh.")}</FieldDescription>
                            </Field>
                            {error && <FieldError>{error}</FieldError>}
                        </FieldGroup>
                        <DialogFooter>
                            <DialogClose render={<Button variant="outline" disabled={pending} />}>{t("Cancel")}</DialogClose>
                            <Button type="submit" disabled={pending}>{pending && <Spinner data-icon="inline-start" />}{t("Save")}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}
