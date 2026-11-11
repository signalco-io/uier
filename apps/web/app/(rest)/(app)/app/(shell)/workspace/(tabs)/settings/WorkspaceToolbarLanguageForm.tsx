'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { useActionState, useId } from 'react';
import { toolbarLanguageLabel, toolbarLanguages, type ToolbarLanguage } from '@uier/toolbar/languages';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { SaveFooter, useSettingsDraft } from '@/src/components/app/SettingsSave';
import { Section } from '@/src/components/app/PageHeader';
import { setWorkspaceToolbarLanguageAction } from './actions';

const options = toolbarLanguages.map(language => ({ value: language, label: toolbarLanguageLabel(language) }));

/**
 * The default language of the toolbar on the workspace's projects. Projects can choose their own,
 * and each person can choose theirs in the toolbar's Options. One save.
 */
export function WorkspaceToolbarLanguageForm({ language }: { language: ToolbarLanguage }) {
    const { t } = useAppI18n();
    const formId = useId();
    const [state, formAction, pending] = useActionState(setWorkspaceToolbarLanguageAction, null);
    const { draft, dirty, update, discard } = useSettingsDraft({ language }, state);
    return (
        <Section
            id="toolbar-language"
            title={t("Toolbar language")}
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <form id={formId} action={formAction}>
                <input type="hidden" name="toolbarLanguage" value={draft.language} />
                <Field>
                    <FieldLabel htmlFor={`${formId}-language`}>{t("Default language")}</FieldLabel>
                    <Select value={draft.language} items={options} disabled={pending}
                        onValueChange={value => update(current => ({ ...current, language: toolbarLanguages.find(item => item === value) ?? current.language }))}>
                        <SelectTrigger id={`${formId}-language`} className="w-full max-w-md">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {options.map(option => <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>)}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <FieldDescription>{t("The language of the review toolbar on this workspace's sites. A project can choose its own in its Review settings, and each person can choose theirs in the toolbar's Options. Comments stay in the language they were written in.")}</FieldDescription>
                </Field>
            </form>
        </Section>
    );
}
