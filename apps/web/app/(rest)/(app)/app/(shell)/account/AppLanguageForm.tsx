'use client';

import { useActionState, useId } from 'react';
import { appLanguages, appLanguageNames, type AppLanguage } from '@/src/lib/i18n/languages';
import { useAppI18n } from '@/src/lib/i18n/client';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { SaveFooter, useSettingsDraft } from '@/src/components/app/SettingsSave';
import { Section } from '@/src/components/app/PageHeader';
import { setAppLanguageAction } from './actions';

type Choice = 'browser' | AppLanguage;

/** The account's app language; Browser default follows Accept-Language, then English. */
export function AppLanguageForm({ language }: { language: AppLanguage | null }) {
    const { t } = useAppI18n();
    const formId = useId();
    const [state, formAction, pending] = useActionState(setAppLanguageAction, null);
    const { draft, dirty, update, discard } = useSettingsDraft<{ language: Choice }>({ language: language ?? 'browser' }, state);
    const options = [
        { value: 'browser', label: t('Browser default') },
        ...appLanguages.map(value => ({ value, label: appLanguageNames[value] }))
    ];
    return (
        <Section id="app-language" title={t('App language')}
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <form id={formId} action={formAction}>
                <input type="hidden" name="appLanguage" value={draft.language} />
                <Field>
                    <FieldLabel htmlFor={`${formId}-language`}>{t('Language')}</FieldLabel>
                    <Select value={draft.language} items={options} disabled={pending}
                        onValueChange={value => update(current => ({ ...current, language: value === 'browser' ? 'browser' : appLanguages.find(language => language === value) ?? 'browser' }))}>
                        <SelectTrigger id={`${formId}-language`} className="w-full max-w-md"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectGroup>
                            {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectGroup></SelectContent>
                    </Select>
                    <FieldDescription>{t('Your choice follows your account. Browser default uses a supported browser language, otherwise English.')}</FieldDescription>
                </Field>
            </form>
        </Section>
    );
}
