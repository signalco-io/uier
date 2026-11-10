import { agentLabels, agentModelText, type AssigneeAgentView } from '../agents';
import { defaultFeedbackTypes, feedbackTypeSnapshot, type CommentKind, type FeedbackType, type FeedbackTypeSnapshot } from '../feedbackTypes';
import type { VerificationDetails } from '../verification';
import type { ToolbarLanguage } from '../languages';
import type { DeviceSettings } from '../userAgent';
import type { Messages } from './en';

// Shared vocabulary (`@uier/toolbar/agents`, `feedback-types`) stays English for the app and the API; the
// toolbar names it in its own language here. Names people chose (a renamed or custom feedback type, an
// environment, a person) are shown as they were written.

/** "Claude Opus 5.5 (high reasoning)" in the toolbar's language: product and model names stay as they are */
export function agentDescription(agent: Pick<AssigneeAgentView, 'label' | 'model' | 'reasoning'> & { kind?: string }, t: Messages) {
    const label = agent.kind === 'agent' && agent.label === agentLabels.agent ? t.agents.generic : agent.label;
    const name = agent.model ? `${label} ${agentModelText({ label: agent.label, model: agent.model })}` : label;
    return agent.reasoning ? `${name} (${t.agents.reasoning(agent.reasoning)})` : name;
}

/** A built-in feedback type as configured: its default name and placeholder in the toolbar's language unless an admin renamed it */
export function feedbackTypeText<T extends Pick<FeedbackType, 'id' | 'label'> & { placeholder?: string }>(type: T, t: Messages): { label: string; placeholder: T['placeholder'] } {
    const builtIn = defaultFeedbackTypes.find(item => item.id === type.id);
    const own = type.id === 'feedback' || type.id === 'bug' ? t.feedbackTypes[type.id] : undefined;
    return {
        label: builtIn && own && type.label === builtIn.label ? own.label : type.label,
        placeholder: builtIn && own && type.placeholder === builtIn.placeholder ? own.placeholder : type.placeholder
    };
}

/** A thread's kind as its label shows it: its saved type's name, else the built-in name in the toolbar's language */
export function commentKindText(kind: CommentKind, snapshot: FeedbackTypeSnapshot | undefined, t: Messages) {
    const saved = feedbackTypeSnapshot(snapshot, kind);
    if (saved) return feedbackTypeText(saved, t).label;
    if (kind === 'comment') return t.feedbackTypes.comment;
    if (kind === 'rewrite') return t.feedbackTypes.rewrite;
    return kind === 'bug' ? t.feedbackTypes.bug.label : t.feedbackTypes.feedback.label;
}

/** A date and time in UTC, as the app shows a verification's ("10 Nov 2026, 11:18 UTC"), in the toolbar's language */
function utcTime(value: string, language: ToolbarLanguage) {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(date) + ' UTC'
        : value;
}

/** `verificationDescription` (`@uier/toolbar/verification`) in the toolbar's language */
export function verificationText(v: VerificationDetails, t: Messages, language: ToolbarLanguage) {
    const decision = v.decision;
    const attribution = decision ? t.verification.attribution(decision.actor, utcTime(decision.at, language), decision.override ? v.reviewer : undefined) : '';
    if (v.outcome === 'confirmed' && decision?.kind === 'confirm') return t.verification.confirmedBy(attribution);
    const requested = t.verification.requested(v.requester, v.reviewer, utcTime(v.requestedAt, language));
    return `${t.verification.outcome[v.outcome]}. ${requested}${decision ? ` ${t.verification.decision[decision.kind](attribution)}` : ''}`;
}

/** `deviceSettings` (`@uier/toolbar/devices`) in the toolbar's language: the same rows in the same order */
export function deviceSettingsText(device: DeviceSettings, t: Messages): [label: string, value: string][] {
    const rows: [string, string | undefined][] = [
        [t.device.model, device.model],
        [t.device.input, device.input && t.device.inputs[device.input]],
        [t.device.colorScheme, device.colorScheme && t.device.colorSchemes[device.colorScheme]],
        [t.device.reducedMotion, device.reducedMotion === undefined ? undefined : device.reducedMotion ? t.device.on : t.device.off],
        [t.device.pageLanguage, device.pageLanguage]
    ];
    return rows.filter((row): row is [string, string] => !!row[1]);
}
