'use client';

import { useId } from 'react';
import { FolderIcon, GlobeIcon, LockIcon, PlusIcon } from 'lucide-react';
import { agentKinds } from '@uier/toolbar/agents';
import { feedbackTypeIcons } from '@uier/toolbar/feedback-types';
import { priorities } from '@uier/toolbar/triage';
import { feedbackStages } from '@uier/toolbar/verification';
import { labelColors, labelIcons, type ThreadLabel } from '@/src/lib/app/threadLabel';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { PersonAvatar } from '@/src/components/app/PersonAvatar';
import { ChoiceCard } from '@/src/components/app/ChoiceCard';
import { FeedbackTypeIcon } from '@/src/components/app/FeedbackTypeIcon';
import { ThreadLabelBadge } from '@/src/components/app/ThreadLabelBadge';
import { AgentAvatar } from '@/src/components/app/comments/AgentAvatar';
import { StateBadge, StateDot } from '@/src/components/app/comments/CommentStatus';
import { PriorityFlag, PriorityLabel } from '@/src/components/app/comments/PriorityFlag';
import { PullRequestStateBadge } from '@/src/components/app/comments/PullRequestStateBadge';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Field, FieldLabel } from '@/src/components/ui/field';
import { RadioGroup } from '@/src/components/ui/radio-group';
import { Specimen, State } from './Specimen';

// Components the app composes from its kit (src/components/app), with example content.

const labelNames: Record<ThreadLabel['color'], string> = {
    ink: 'Content', blue: 'Design', sky: 'Copy', violet: 'Idea', green: 'Quick win', amber: 'Needs info', red: 'Regression'
};

function PageHeaderSpecimen() {
    return (
        <Specimen id="app-page-header" columns={1}>
            <State label="Title and description">
                <PageHeader className="w-full pb-0" title="Projects" description="Sites your workspace reviews." />
            </State>
            <State label="With media and actions">
                <PageHeader
                    className="w-full pb-0"
                    title="Cafe Lumen"
                    description="cafelumen.com"
                    media={<span className="flex size-14 shrink-0 items-center justify-center rounded-xl border"><GlobeIcon aria-hidden="true" /></span>}
                    actions={<><Button variant="outline">Settings</Button><Button><PlusIcon data-icon="inline-start" />Invite</Button></>}
                />
            </State>
        </Specimen>
    );
}

function SectionSpecimen() {
    const id = useId();
    return (
        <Specimen id="app-section" columns={2}>
            <State label="Default">
                <Section className="w-full" title="Project name" description="Reviewers see it in the toolbar.">
                    <Field>
                        <FieldLabel htmlFor={`${id}-name`} className="sr-only">Project name</FieldLabel>
                        <Input id={`${id}-name`} defaultValue="Cafe Lumen" />
                    </Field>
                </Section>
            </State>
            <State label="With icon, action and footer">
                <Section
                    className="w-full"
                    title="Private project"
                    icon={<LockIcon />}
                    description="Only members can open review links."
                    actions={<Button variant="outline" size="sm">Change</Button>}
                    footer={<Button size="sm">Save</Button>}
                />
            </State>
        </Specimen>
    );
}

function PersonAvatarSpecimen() {
    return (
        <Specimen id="app-person-avatar">
            <State label="Initial"><PersonAvatar name="Lena Eriksen" /></State>
            <State label="Picture"><PersonAvatar name="uier" avatarUrl="/apple-touch-icon.png" /></State>
            <State label="Sizes">
                <PersonAvatar name="Lena Eriksen" size="sm" />
                <PersonAvatar name="Lena Eriksen" />
                <PersonAvatar name="Lena Eriksen" size="lg" />
            </State>
        </Specimen>
    );
}

function AgentAvatarSpecimen() {
    return (
        <Specimen id="app-agent-avatar" columns={2}>
            <State label="Each agent">{agentKinds.map(kind => <AgentAvatar key={kind} kind={kind} />)}</State>
            <State label="Larger">{agentKinds.map(kind => <AgentAvatar key={kind} kind={kind} className="size-8" />)}</State>
        </Specimen>
    );
}

function StatusSpecimen() {
    return (
        <Specimen id="app-status" columns={2}>
            <State label="Badge">{feedbackStages.map(status => <StateBadge key={status} status={status} />)}</State>
            <State label="Dot">{feedbackStages.map(status => <StateDot key={status} status={status} />)}</State>
        </Specimen>
    );
}

function PrioritySpecimen() {
    return (
        <Specimen id="app-priority" columns={2}>
            <State label="Label">{priorities.map(priority => <PriorityLabel key={priority} priority={priority} />)}</State>
            <State label="Flag with name">
                {priorities.map(priority => (
                    <span key={priority} className="inline-flex items-center gap-1.5 text-sm capitalize"><PriorityFlag priority={priority} className="size-4" />{priority}</span>
                ))}
            </State>
        </Specimen>
    );
}

function PullRequestSpecimen() {
    return (
        <Specimen id="app-pull-request" columns={1}>
            <State label="Each state">{(['open', 'draft', 'merged', 'closed'] as const).map(state => <PullRequestStateBadge key={state} state={state} />)}</State>
        </Specimen>
    );
}

function ThreadLabelSpecimen() {
    return (
        <Specimen id="app-thread-label" columns={2}>
            <State label="Each colour">
                {labelColors.map(color => (
                    <ThreadLabelBadge key={color} label={{ id: `label_${color}`, name: labelNames[color], color, description: '' }} />
                ))}
            </State>
            <State label="Each icon">
                {labelIcons.map(icon => (
                    <ThreadLabelBadge key={icon} label={{ id: `label_${icon}`, name: icon.replace('-', ' '), color: 'ink', icon, description: '' }} />
                ))}
            </State>
        </Specimen>
    );
}

function FeedbackTypeSpecimen() {
    return (
        <Specimen id="app-feedback-type" columns={1}>
            <State label="Each icon">
                {feedbackTypeIcons.map(icon => (
                    <span key={icon} className="inline-flex items-center gap-1.5 text-sm"><FeedbackTypeIcon icon={icon} aria-hidden="true" className="size-4" />{icon}</span>
                ))}
            </State>
        </Specimen>
    );
}

function ChoiceCardSpecimen() {
    const id = useId();
    return (
        <Specimen id="app-choice-card" columns={1}>
            <State label="Group with one chosen">
                <RadioGroup defaultValue="site" aria-label="What to review" className="w-full gap-3 md:grid-cols-2">
                    <ChoiceCard id={`${id}-site`} value="site" title="A website" description="Comments pinned to elements of a live site." icon={<GlobeIcon aria-hidden="true" />} />
                    <ChoiceCard id={`${id}-files`} value="files" title="Files" description="Comments on images and PDFs you upload." icon={<FolderIcon aria-hidden="true" />} />
                </RadioGroup>
            </State>
        </Specimen>
    );
}

export function AppPatternSpecimens() {
    return (
        <>
            <PageHeaderSpecimen />
            <SectionSpecimen />
            <PersonAvatarSpecimen />
            <AgentAvatarSpecimen />
            <StatusSpecimen />
            <PrioritySpecimen />
            <PullRequestSpecimen />
            <ThreadLabelSpecimen />
            <FeedbackTypeSpecimen />
            <ChoiceCardSpecimen />
        </>
    );
}
