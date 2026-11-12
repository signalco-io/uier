'use client';

import { useId } from 'react';
import { PlusIcon, TrashIcon } from 'lucide-react';
import { labelColors, labelIcons, type ThreadLabel } from '@/src/lib/app/threadLabel';
import { useAppI18n } from '@/src/lib/i18n/client';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ThreadLabelBadge, ThreadLabelMark } from './ThreadLabelBadge';

const colorNames = { ink: 'Ink', blue: 'Blue', sky: 'Sky', violet: 'Violet', green: 'Green', amber: 'Amber', red: 'Red' };
const iconNames = { tag: 'Tag', bug: 'Bug', sparkles: 'Sparkles', accessibility: 'Accessibility', paintbrush: 'Paintbrush', code: 'Code', 'file-text': 'File text', flag: 'Flag' };

export function ThreadLabelsEditor({ value, onChange, disabled = false }: { value: ThreadLabel[]; onChange: (value: ThreadLabel[]) => void; disabled?: boolean }) {
    const { t } = useAppI18n();
    const id = useId();
    const change = (label: ThreadLabel, patch: Partial<ThreadLabel>) => onChange(value.map(item => item.id === label.id ? { ...item, ...patch } : item));
    return <FieldGroup>
        <FieldDescription>{t('Create up to 50 labels. Removing a label hides it on existing threads.')}</FieldDescription>
        {value.map(label => <FieldGroup key={label.id} className="gap-3 rounded-xl border p-4">
            <ThreadLabelBadge label={{ ...label, name: label.name || t('Label name') }} />
            <Field>
                <FieldLabel htmlFor={`${id}-${label.id}-name`}>{t('Label name')}</FieldLabel>
                <Input id={`${id}-${label.id}-name`} value={label.name} required maxLength={40} disabled={disabled} onChange={event => change(label, { name: event.target.value })} />
            </Field>
            <Field>
                <FieldLabel htmlFor={`${id}-${label.id}-description`}>{t('Label description')}</FieldLabel>
                <Input id={`${id}-${label.id}-description`} value={label.description} maxLength={500} disabled={disabled} onChange={event => change(label, { description: event.target.value })} />
            </Field>
            <Field>
                <FieldLabel htmlFor={`${id}-${label.id}-color`}>{t('Label color')}</FieldLabel>
                <Select value={label.color} items={labelColors.map(color => ({ value: color, label: t(colorNames[color]) }))} disabled={disabled} onValueChange={color => { if (color) change(label, { color }); }}>
                    <SelectTrigger id={`${id}-${label.id}-color`} className="w-full pointer-coarse:min-h-11"><ThreadLabelMark label={label} /><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>{labelColors.map(color => <SelectItem key={color} value={color} className="pointer-coarse:min-h-11"><ThreadLabelMark label={{ ...label, color }} />{t(colorNames[color])}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
            </Field>
            <Field>
                <FieldLabel htmlFor={`${id}-${label.id}-icon`}>{t('Label icon')}</FieldLabel>
                <Select value={label.icon ?? 'none'} items={[{ value: 'none', label: t('No icon') }, ...labelIcons.map(icon => ({ value: icon, label: t(iconNames[icon]) }))]} disabled={disabled}
                    onValueChange={icon => { if (icon) change(label, { icon: labelIcons.find(value => value === icon) }); }}>
                    <SelectTrigger id={`${id}-${label.id}-icon`} className="w-full pointer-coarse:min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup><SelectItem value="none" className="pointer-coarse:min-h-11">{t('No icon')}</SelectItem>{labelIcons.map(icon => <SelectItem key={icon} value={icon} className="pointer-coarse:min-h-11"><ThreadLabelMark label={{ ...label, icon }} />{t(iconNames[icon])}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
            </Field>
            <Button variant="outline" size="sm" className="self-start pointer-coarse:min-h-11" disabled={disabled} aria-label={t('Remove label {name}', { name: label.name })} onClick={() => onChange(value.filter(item => item.id !== label.id))}><TrashIcon data-icon="inline-start" />{t('Remove')}</Button>
        </FieldGroup>)}
        {!disabled && <Button variant="outline" className="self-start pointer-coarse:min-h-11" disabled={value.length >= 50} onClick={() => onChange([...value, { id: `label_${crypto.randomUUID()}`, name: '', color: 'ink', description: '' }])}><PlusIcon data-icon="inline-start" />{t('Add label')}</Button>}
    </FieldGroup>;
}
