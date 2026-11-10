'use client';

import { useActionState, useId } from 'react';
import { toolbarLanguageLabel, toolbarLanguages, type ToolbarLanguage } from '@uier/toolbar/languages';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { SaveFooter, useSettingsDraft } from '@/src/components/app/SettingsSave';
import { Section } from '@/src/components/app/PageHeader';
import { setToolbarLanguageAction } from './actions';

/** The account's choice, or `default`: each project's language (the project's, else its workspace's) */
type Choice = 'default' | ToolbarLanguage;

const options = [
    { value: 'default', label: 'Project default' },
    ...toolbarLanguages.map(language => ({ value: language, label: toolbarLanguageLabel(language) }))
] satisfies { value: Choice; label: string }[];

/**
 * The toolbar's language for this account, on every site it reviews, the same choice as the toolbar's
 * Options. Project default goes back to each project's language. One save.
 */
export function ToolbarLanguageForm({ language }: { language: ToolbarLanguage | null }) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(setToolbarLanguageAction, null);
    const { draft, dirty, update, discard } = useSettingsDraft<{ language: Choice }>({ language: language ?? 'default' }, state);
    return (
        <Section
            id="toolbar-language"
            title="Toolbar language"
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <form id={formId} action={formAction}>
                <input type="hidden" name="toolbarLanguage" value={draft.language} />
                <Field>
                    <FieldLabel htmlFor={`${formId}-language`}>Language</FieldLabel>
                    <Select value={draft.language} items={options} disabled={pending}
                        onValueChange={value => update(current => ({ ...current, language: options.find(option => option.value === value)?.value ?? 'default' }))}>
                        <SelectTrigger id={`${formId}-language`} className="w-full max-w-md">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <FieldDescription>
                        The review toolbar&apos;s language on every site you review, also chosen in the toolbar&apos;s Options. Project default uses each project&apos;s language, set by its admins, else the workspace&apos;s, else English.
                    </FieldDescription>
                </Field>
            </form>
        </Section>
    );
}
