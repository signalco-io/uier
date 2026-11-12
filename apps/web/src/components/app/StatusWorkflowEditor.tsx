'use client';

import { useId } from 'react';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { orderedStatuses, statusCategories, statusCategoryLabels, type StatusWorkflow, type WorkflowStatus } from '@/src/lib/app/statusWorkflow';
import { Button } from '../ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../ui/field';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export function StatusWorkflowEditor({ value, onChange, disabled = false, verificationEnabled = true }: { verificationEnabled?: boolean; value: StatusWorkflow; onChange: (value: StatusWorkflow) => void; disabled?: boolean }) {
    const { t } = useAppI18n();
    const id = useId();
    const change = (status: WorkflowStatus, patch: Partial<WorkflowStatus>) => onChange({ ...value, statuses: value.statuses.map(item => item.id === status.id ? { ...item, ...patch } : item) });
    const move = (status: WorkflowStatus, offset: number) => {
        const statuses = orderedStatuses(value);
        const index = statuses.findIndex(item => item.id === status.id);
        const beside = statuses[index + offset];
        if (!beside || beside.category !== status.category) return;
        [statuses[index], statuses[index + offset]] = [beside, status];
        onChange({ ...value, statuses });
    };
    const remove = (status: WorkflowStatus) => {
        const statuses = value.statuses.filter(item => item.id !== status.id);
        const replacement = statuses.find(item => item.category === status.category)!.id;
        onChange({ statuses, initialStatusId: value.initialStatusId === status.id ? replacement : value.initialStatusId,
            doneStatusId: value.doneStatusId === status.id ? replacement : value.doneStatusId, archiveStatusId: value.archiveStatusId === status.id ? replacement : value.archiveStatusId });
    };
    return <FieldGroup>
        <FieldDescription>{t('Statuses keep their category. Filters and verification follow the category. Removed statuses return existing threads to a status in the same category.')}</FieldDescription>
        {statusCategories.filter(category => verificationEnabled || category !== 'ready').map(category => {
            const statuses = value.statuses.filter(status => status.category === category);
            return <FieldSet key={category} disabled={disabled} className="min-w-0 rounded-xl border p-4">
                <FieldLegend variant="label">{t(statusCategoryLabels[category])}</FieldLegend>
                <FieldGroup>
                    {statuses.map((status, index) => <FieldGroup key={status.id} className="gap-3 rounded-lg border p-3">
                        <Field>
                            <FieldLabel htmlFor={`${id}-${status.id}-label`}>{t('Status name')}</FieldLabel>
                            <Input id={`${id}-${status.id}-label`} value={status.label} required maxLength={40} disabled={disabled} onChange={event => change(status, { label: event.target.value })} />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor={`${id}-${status.id}-description`}>{t('Description')}</FieldLabel>
                            <Input id={`${id}-${status.id}-description`} value={status.description} maxLength={500} disabled={disabled} onChange={event => change(status, { description: event.target.value })} />
                        </Field>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" className="pointer-coarse:min-h-11" aria-label={t('Move up {name}', { name: status.label })} disabled={disabled || index === 0} onClick={() => move(status, -1)}><ArrowUpIcon />{t('Move up')}</Button>
                            <Button variant="outline" size="sm" className="pointer-coarse:min-h-11" aria-label={t('Move down {name}', { name: status.label })} disabled={disabled || index === statuses.length - 1} onClick={() => move(status, 1)}><ArrowDownIcon />{t('Move down')}</Button>
                            <Button variant="outline" size="sm" className="pointer-coarse:min-h-11" aria-label={t('Remove {name}', { name: status.label })} disabled={disabled || statuses.length === 1} onClick={() => remove(status)}><TrashIcon />{t('Remove')}</Button>
                        </div>
                    </FieldGroup>)}
                    {!disabled && <Button variant="outline" className="self-start pointer-coarse:min-h-11" disabled={value.statuses.length >= 30} onClick={() => onChange({ ...value, statuses: [...value.statuses, { id: `custom_${crypto.randomUUID()}`, category, label: '', description: '' }] })}><PlusIcon />{t('Add status to {category}', { category: t(statusCategoryLabels[category]) })}</Button>}
                </FieldGroup>
            </FieldSet>;
        })}
        {([
            ['initialStatusId', 'New comments start in', value.statuses.filter(status => status.category === 'open' || status.category === 'in-progress')],
            ['doneStatusId', 'Done action uses', value.statuses.filter(status => status.category === 'done')],
            ['archiveStatusId', 'Archive action uses', value.statuses.filter(status => status.category === 'archive')]
        ] as const).map(([field, label, statuses]) => <Field key={field}>
            <FieldLabel htmlFor={`${id}-${field}`}>{t(label)}</FieldLabel>
            <Select value={value[field]} items={statuses.map(status => ({ value: status.id, label: status.label }))} disabled={disabled}
                onValueChange={next => { if (next) onChange({ ...value, [field]: next }); }}>
                <SelectTrigger id={`${id}-${field}`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{statuses.map(status => <SelectItem key={status.id} value={status.id}>{status.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
            {field === 'initialStatusId' && <FieldDescription>{t('New comments must start in Open or In progress so they appear in active feedback.')}</FieldDescription>}
        </Field>)}
    </FieldGroup>;
}
