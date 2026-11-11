'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useId } from 'react';
import { PlusIcon } from 'lucide-react';
import { feedbackTypeIcons, MAX_FEEDBACK_TYPES, MAX_FEEDBACK_TYPE_LABEL, MAX_FEEDBACK_TYPE_PLACEHOLDER, type FeedbackType } from '@uier/toolbar/feedback-types';
import { Button } from '../ui/button';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../ui/field';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { FeedbackTypeIcon } from './FeedbackTypeIcon';

const iconLabels = { heart: 'Heart', bug: 'Bug', message: 'Message', sparkles: 'Sparkles', rocket: 'Rocket', bookmark: 'Bookmark', info: 'Info', lightning: 'Lightning' };
const iconOptions = feedbackTypeIcons.map(icon => ({ value: icon, label: iconLabels[icon] }));

/** A draft inside its parent's settings form. Disable instead of deleting to keep types recognizable. */
export function FeedbackTypesEditor({ value, onChange, disabled = false }: { value: FeedbackType[]; onChange: (types: FeedbackType[]) => void; disabled?: boolean }) {
    const { t, language } = useAppI18n();
    const id = useId();
    const change = (index: number, patch: Partial<FeedbackType>) => onChange(value.map((type, i) => i === index ? { ...type, ...patch } : type));
    return <FieldGroup>
        {value.map((type, index) => {
            const custom = type.id.startsWith('custom_');
            const prefix = `${id}-${type.id}`;
            return <FieldSet key={type.id} className="min-w-0 rounded-xl border p-4" disabled={disabled} aria-label={type.label || 'New feedback type'}>
                <FieldLegend className="sr-only">{type.label || 'New feedback type'}</FieldLegend>
                <FieldGroup>
                    <Field orientation="horizontal">
                        <FeedbackTypeIcon icon={type.icon} className="size-4 shrink-0" />
                        <FieldContent className="min-w-0"><FieldLabel htmlFor={`${prefix}-enabled`} className="max-w-full"><span className="truncate" title={t(type.label)}>{type.label || 'New feedback type'}</span></FieldLabel></FieldContent>
                        <Switch id={`${prefix}-enabled`} checked={type.enabled} disabled={disabled}
                            aria-label={t("Enable {value1}", { value1: type.label || 'new feedback type' })} onCheckedChange={enabled => change(index, { enabled })} />
                    </Field>
                    {custom && <>
                        <Field>
                            <FieldLabel htmlFor={`${prefix}-name`}>{t("Type name")}</FieldLabel>
                            <Input id={`${prefix}-name`} value={type.label} disabled={disabled} required maxLength={MAX_FEEDBACK_TYPE_LABEL}
                                onChange={event => change(index, { label: event.target.value })} />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor={`${prefix}-icon`}>{t("Icon")}</FieldLabel>
                            <Select value={type.icon} items={iconOptions} disabled={disabled}
                                onValueChange={icon => { if (icon) change(index, { icon }); }}>
                                <SelectTrigger id={`${prefix}-icon`} className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectGroup>{iconOptions.map(option => <SelectItem key={option.value} value={option.value}>
                                    <FeedbackTypeIcon icon={option.value} />{t(option.label)}
                                </SelectItem>)}</SelectGroup></SelectContent>
                            </Select>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor={`${prefix}-placeholder`}>{t("Placeholder text")}</FieldLabel>
                            <Input id={`${prefix}-placeholder`} value={type.placeholder} disabled={disabled} required maxLength={MAX_FEEDBACK_TYPE_PLACEHOLDER}
                                onChange={event => change(index, { placeholder: event.target.value })} />
                            <FieldDescription>{t("A prompt shown before the reviewer starts typing.")}</FieldDescription>
                        </Field>
                    </>}
                </FieldGroup>
            </FieldSet>;
        })}
        {!disabled && <Button variant="outline" className="self-start" disabled={value.length >= MAX_FEEDBACK_TYPES}
            onClick={() => onChange([...value, { id: `custom_${crypto.randomUUID()}`, label: '', icon: 'message', placeholder: '', enabled: true }])}>
            <PlusIcon data-icon="inline-start" />{t("Add feedback type")}{' '}</Button>}
        <FieldDescription>{t("Turn a type off to hide it from new feedback. Existing threads keep their type. Up to")}{' '}{MAX_FEEDBACK_TYPES} {t("types.")}</FieldDescription>
    </FieldGroup>;
}
