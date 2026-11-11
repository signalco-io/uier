'use client';

import { ToolbarFeaturesFields } from './ToolbarFeaturesFields';
import type { ToolbarFeatureVisibility } from '@uier/toolbar/toolbar-features';
import type { FeedbackType } from '@uier/toolbar/feedback-types';
import type { DbProject } from '../../../lib/app/model';
import { FeedbackTypesEditor } from '../FeedbackTypesEditor';
import { useActionState, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRightIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from '@/src/components/ui/field';
import { Textarea } from '@/src/components/ui/textarea';
import { Input } from '@/src/components/ui/input';
import { RadioGroup } from '@/src/components/ui/radio-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { KnownPages, projectAccessAnchor } from '../../../knownPages';
import { ChoiceCard } from '../ChoiceCard';
import { Section } from '../PageHeader';
import { SaveFooter, useSettingsDraft } from '../SettingsSave';
import { MAX_PROJECT_BRIEF_LENGTH } from '../../../lib/app/limits';
import type { ProjectAccess } from '../../../lib/app/model';
import { AccessIcon, projectAccessLabels } from './projectLabels';
import { updateProjectReviewAction } from './actions';
import { pageStatePolicy, type PageStatePolicy } from '@uier/toolbar/page-state';
import type { QueryFieldSuggestion } from '../../../lib/app/pageStateSuggestions';
import { toolbarLanguageLabel, toolbarLanguages, type ToolbarLanguage } from '@uier/toolbar/languages';
import { keepValues } from './keepFormValues';

/** A project's toolbar language: the workspace's (nothing stored) or its own */
type ProjectToolbarLanguage = 'workspace' | ToolbarLanguage;

/** Review: who can comment, the toolbar's language, the brief and, under Advanced, the page state; one save */
export function ProjectReviewForm({ projectId, access, brief, policy, suggestions, guestLinks, feedbackTypes, workspaceTypes, toolbarLanguage, workspaceToolbarLanguage, toolbarFeatures }: {
    projectId: string;
    access: ProjectAccess;
    /** The project's own toolbar language, or the workspace's */
    toolbarLanguage: ProjectToolbarLanguage;
    /** The workspace's default, which `workspace` follows */
    workspaceToolbarLanguage: ToolbarLanguage;
    toolbarFeatures?: ToolbarFeatureVisibility;
    /** The saved access's guest links, shown under Who can comment while it stays chosen */
    guestLinks?: ReactNode;
    brief?: string;
    policy?: PageStatePolicy;
    suggestions: QueryFieldSuggestion[];
    feedbackTypes?: DbProject['feedbackTypes'];
    workspaceTypes: FeedbackType[];
}) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateProjectReviewAction, null);
    const saved = pageStatePolicy(policy);
    const { draft, dirty, update, discard } = useSettingsDraft({
        access,
        toolbarLanguage,
        toolbarFeatures: toolbarFeatures ?? {},
        brief: brief ?? '',
        feedbackTypesMode: feedbackTypes ? 'replace' as const : 'workspace' as const,
        feedbackTypes: feedbackTypes?.value ?? workspaceTypes,
        queryParameters: saved.queryParameters.join(', '),
        hashRouting: saved.hashRouting
    }, state);
    const entered = draft.queryParameters.split(/[,\s]+/).filter(Boolean);
    const available = suggestions.filter(suggestion => !entered.includes(suggestion.key));
    // Open while the page state is set up, so what applies is in sight
    const [advanced, setAdvanced] = useState(saved.queryParameters.length > 0 || saved.hashRouting);
    const languageOptions = [
        { value: 'workspace', label: `Workspace default (${toolbarLanguageLabel(workspaceToolbarLanguage)})` },
        ...toolbarLanguages.map(language => ({ value: language, label: toolbarLanguageLabel(language) }))
    ] satisfies { value: ProjectToolbarLanguage; label: string }[];

    return (
        <Section
            id="review"
            title="Review"
            stickyFooter
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <form id={formId} action={formAction} onResetCapture={keepValues}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="feedbackTypes" value={draft.feedbackTypesMode === 'workspace' ? 'workspace' : JSON.stringify({ mode: 'replace', value: draft.feedbackTypes })} />
                <input type="hidden" name="access" value={draft.access} />
                <input type="hidden" name="toolbarLanguage" value={draft.toolbarLanguage} />
                <input type="hidden" name="toolbarFeatures" value={JSON.stringify(draft.toolbarFeatures)} />
                <input type="hidden" name="queryParameters" value={draft.queryParameters} />
                <input type="hidden" name="hashRouting" value={String(draft.hashRouting)} />
                <FieldGroup>
                    {/* The header's access label links here */}
                    <FieldSet id={projectAccessAnchor} className="scroll-mt-6">
                        <FieldLegend variant="label">Who can comment</FieldLegend>
                        <FieldDescription>Who can see and leave comments with the toolbar on your site.</FieldDescription>
                        <RadioGroup value={draft.access} onValueChange={(next) => update(current => ({ ...current, access: next as ProjectAccess }))} aria-label="Who can comment">
                            {(['invited', 'guests', 'disabled'] as const).map(option => (
                                <ChoiceCard
                                    key={option}
                                    id={`${formId}-${option}`}
                                    value={option}
                                    title={projectAccessLabels[option].label}
                                    description={projectAccessLabels[option].description}
                                    icon={<AccessIcon access={option} aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />} />
                            ))}
                        </RadioGroup>
                        {guestLinks && draft.access === 'guests' && guestLinks}
                    </FieldSet>
                    <FieldSeparator />
                    <Field>
                        <FieldLabel htmlFor={`${formId}-toolbar-language`}>Toolbar language</FieldLabel>
                        <Select value={draft.toolbarLanguage} items={languageOptions}
                            onValueChange={value => update(current => ({ ...current, toolbarLanguage: languageOptions.find(option => option.value === value)?.value ?? 'workspace' }))}>
                            <SelectTrigger id={`${formId}-toolbar-language`} className="w-full max-w-md">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {languageOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <FieldDescription>
                            What reviewers see the toolbar in. People who choose their own language in the toolbar&apos;s Options keep it. Change the workspace default in <Link href={KnownPages.AppSettings} className="underline underline-offset-4 hover:text-foreground">Workspace settings</Link>.
                        </FieldDescription>
                    </Field>
                    <FieldSeparator />
                    <ToolbarFeaturesFields value={draft.toolbarFeatures} onChange={toolbarFeatures => update(current => ({ ...current, toolbarFeatures }))} guests={draft.access === 'guests'} disabled={pending} />
                    <FieldSeparator />
                    <Field>
                        <FieldLabel htmlFor={`${formId}-brief`}>Review brief</FieldLabel>
                        <Textarea id={`${formId}-brief`} name="brief" value={draft.brief} onChange={event => update(current => ({ ...current, brief: event.target.value }))}
                            maxLength={MAX_PROJECT_BRIEF_LENGTH} rows={5} placeholder="What should reviewers look at?" aria-describedby={`${formId}-readers`} />
                        <FieldDescription id={`${formId}-readers`}>
                            {draft.access === 'disabled'
                                ? 'Hidden while comments are off.'
                                : draft.access === 'invited' ? 'Invited people read it in the toolbar.' : 'Anyone with the review link reads it in the toolbar.'}
                            {' '}Plain text, up to {MAX_PROJECT_BRIEF_LENGTH} characters.
                        </FieldDescription>
                    </Field>
                    <FieldSeparator />
                    <FieldSet>
                        <FieldLegend variant="label">Feedback types</FieldLegend>
                        <FieldDescription>The choices in Send feedback. Pinned comments and suggested rewrites stay available separately.</FieldDescription>
                        <FieldGroup>
                            <Field>
                                <FieldLabel htmlFor={`${formId}-feedback-types`}>Feedback type defaults</FieldLabel>
                                <Select value={draft.feedbackTypesMode} items={[{ value: 'workspace', label: 'Workspace defaults' }, { value: 'replace', label: 'Project override' }]}
                                    onValueChange={mode => { if (mode) update(current => ({ ...current, feedbackTypesMode: mode })); }}>
                                    <SelectTrigger id={`${formId}-feedback-types`} className="w-full max-w-md"><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectGroup>
                                        <SelectItem value="workspace">Workspace defaults</SelectItem>
                                        <SelectItem value="replace">Project override</SelectItem>
                                    </SelectGroup></SelectContent>
                                </Select>
                                <FieldDescription>Workspace defaults follow future workspace changes. An override keeps this project's own list.</FieldDescription>
                            </Field>
                            <FeedbackTypesEditor value={draft.feedbackTypesMode === 'workspace' ? workspaceTypes : draft.feedbackTypes}
                                onChange={types => update(current => ({ ...current, feedbackTypes: types }))} disabled={draft.feedbackTypesMode === 'workspace' || pending} />
                        </FieldGroup>
                    </FieldSet>
                    <FieldSeparator />
                    <Collapsible open={advanced} onOpenChange={setAdvanced} className="flex flex-col gap-4">
                        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/advanced h-auto self-start px-0 py-1 text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground dark:hover:bg-transparent" />}>
                            <ChevronRightIcon data-icon="inline-start" className="transition-transform group-data-panel-open/advanced:rotate-90" />
                            Advanced
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <FieldSet>
                                <FieldLegend variant="label">Page state</FieldLegend>
                                <FieldDescription>Comments belong to the page path. Add the parts of the address that change what is on the page, so comments stay with that view.</FieldDescription>
                                <FieldGroup>
                                    <Field>
                                        <FieldLabel htmlFor={`${formId}-query`}>Meaningful query fields</FieldLabel>
                                        <Input id={`${formId}-query`} value={draft.queryParameters} onChange={event => update(current => ({ ...current, queryParameters: event.target.value }))}
                                            placeholder="category, sort, tab" className="font-mono text-[13px] md:text-[13px]" />
                                        <FieldDescription>Up to 12 names, separated by commas. Tracking, identity and credential fields are left out, and so are values that look like emails, URLs or tokens.</FieldDescription>
                                        {available.length > 0 && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Query fields seen in recent comments">
                                            <span className="text-sm text-muted-foreground">Seen in recent comments:</span>
                                            {available.map(suggestion => <Button key={suggestion.key} variant="outline" size="xs"
                                                title={`On ${suggestion.comments} recent ${suggestion.comments === 1 ? 'comment' : 'comments'}`}
                                                onClick={() => update(current => ({ ...current, queryParameters: [...entered, suggestion.key].join(', ') }))}>
                                                <PlusIcon data-icon="inline-start" /><span className="font-mono">{suggestion.key}</span>
                                            </Button>)}
                                        </div>}
                                    </Field>
                                    <Field orientation="horizontal">
                                        <Checkbox id={`${formId}-hash`} checked={draft.hashRouting} onCheckedChange={value => update(current => ({ ...current, hashRouting: value === true }))} />
                                        <FieldLabel htmlFor={`${formId}-hash`}>Use hash routes (#/page or #!/page)</FieldLabel>
                                    </Field>
                                </FieldGroup>
                            </FieldSet>
                        </CollapsibleContent>
                    </Collapsible>
                </FieldGroup>
            </form>
        </Section>
    );
}
