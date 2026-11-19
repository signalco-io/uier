'use client';

import { useId } from 'react';
import { flushSync } from 'react-dom';
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, EllipsisIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useAppI18n } from '@/src/lib/i18n/client';
import { statusCategories, statusCategoryLabels, type StatusCategory, type StatusWorkflow, type WorkflowStatus } from '@/src/lib/app/statusWorkflow';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../ui/field';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { StateDot } from './comments/CommentStatus';

const MAX_STATUSES = 30;

/**
 * A row's columns: the category's mark, the name, the description and the actions on one line where the editor is wide
 * enough; below that the description goes under the name. The actions column keeps its width while a category has
 * nothing to move or remove, so names and descriptions line up across categories.
 */
const rowColumns = 'grid-cols-[0.875rem_minmax(0,1fr)_2rem] pointer-coarse:grid-cols-[0.875rem_minmax(0,1fr)_2.75rem] '
    + '@lg/statuses:grid-cols-[0.875rem_minmax(0,2fr)_minmax(0,3fr)_2rem] @lg/statuses:pointer-coarse:grid-cols-[0.875rem_minmax(0,2fr)_minmax(0,3fr)_2.75rem]';

/** A status's category beside its name (BRAND.md, "Status"): the category's dot, or the archive destination icon */
function CategoryMark({ category }: { category: StatusCategory }) {
    return <span aria-hidden="true" className="flex w-3.5 shrink-0 items-center justify-center">
        {category === 'archive' ? <ArchiveIcon className="size-3.5 text-muted-foreground" /> : <StateDot status={category} />}
    </span>;
}

/**
 * The statuses of a workflow, part of its parent's settings draft and Save (workspace Statuses, project Review): per
 * category a short list of rows (the category's dot, the name, an optional description, a menu to move or remove the
 * status) with Add status after it, then the statuses the new comment, Done and Archive actions use.
 */
export function StatusWorkflowEditor({ value, onChange, disabled = false, verificationEnabled = true }: { verificationEnabled?: boolean; value: StatusWorkflow; onChange: (value: StatusWorkflow) => void; disabled?: boolean }) {
    const { t } = useAppI18n();
    const id = useId();
    const fieldId = (status: WorkflowStatus, field: 'label' | 'description' | 'actions') => `${id}-${status.id}-${field}`;
    const name = (status: WorkflowStatus) => status.label.trim() || t('New status');
    const inCategory = (category: StatusCategory) => value.statuses.filter(status => status.category === category);
    const change = (status: WorkflowStatus, patch: Partial<WorkflowStatus>) => onChange({ ...value, statuses: value.statuses.map(item => item.id === status.id ? { ...item, ...patch } : item) });
    // Swaps the status with its neighbour in the category; the order of the other categories stays as it is
    const move = (status: WorkflowStatus, offset: -1 | 1) => {
        const siblings = inCategory(status.category);
        const beside = siblings[siblings.findIndex(item => item.id === status.id) + offset];
        if (!beside) return;
        onChange({ ...value, statuses: value.statuses.map(item => item.id === status.id ? beside : item.id === beside.id ? status : item) });
    };
    const add = (category: StatusCategory) => {
        const status: WorkflowStatus = { id: `custom_${crypto.randomUUID()}`, category, label: '', description: '' };
        // After the category's last status, so removing it again leaves the statuses as they were
        const after = value.statuses.map(item => item.category).lastIndexOf(category) + 1;
        // The new row is rendered at once, so focus can move into its name
        flushSync(() => onChange({ ...value, statuses: [...value.statuses.slice(0, after), status, ...value.statuses.slice(after)] }));
        document.getElementById(fieldId(status, 'label'))?.focus();
    };
    const remove = (status: WorkflowStatus) => {
        const siblings = inCategory(status.category);
        const index = siblings.findIndex(item => item.id === status.id);
        const statuses = value.statuses.filter(item => item.id !== status.id);
        const replacement = statuses.find(item => item.category === status.category)!.id;
        flushSync(() => onChange({ ...value, statuses, initialStatusId: value.initialStatusId === status.id ? replacement : value.initialStatusId,
            doneStatusId: value.doneStatusId === status.id ? replacement : value.doneStatusId, archiveStatusId: value.archiveStatusId === status.id ? replacement : value.archiveStatusId }));
        // The focus stays in the category: on the status that took this one's place, else the one before it
        const next = siblings.filter(item => item.id !== status.id)[Math.min(index, siblings.length - 2)]!;
        (document.getElementById(fieldId(next, 'actions')) ?? document.getElementById(fieldId(next, 'label')))?.focus();
    };
    const defaults = [
        ['initialStatusId', 'New comments start in', value.statuses.filter(status => status.category === 'open' || status.category === 'in-progress')],
        ['doneStatusId', 'Done action uses', inCategory('done')],
        ['archiveStatusId', 'Archive action uses', inCategory('archive')]
    ] as const;

    return <FieldGroup>
        <FieldDescription>{t('Statuses keep their category, and each category keeps at least one. Filters and verification follow the category. Removed statuses return existing threads to a status in the same category.')}</FieldDescription>
        <div className="@container/statuses flex flex-col gap-5">
            {statusCategories.filter(category => verificationEnabled || category !== 'ready').map(category => {
                const statuses = inCategory(category);
                const categoryLabel = t(statusCategoryLabels[category]);
                return <FieldSet key={category} disabled={disabled} className="min-w-0 gap-1">
                    <FieldLegend variant="label" className="mb-2">{categoryLabel}</FieldLegend>
                    <ul className="m-0 flex list-none flex-col gap-3 p-0 @lg/statuses:gap-2">
                        {statuses.map((status, index) => {
                            const canMoveUp = index > 0;
                            const canMoveDown = index < statuses.length - 1;
                            const canRemove = statuses.length > 1;
                            return <li key={status.id} className={`grid items-center gap-x-3 gap-y-2 ${rowColumns}`}>
                                <CategoryMark category={category} />
                                <Input id={fieldId(status, 'label')} aria-label={t('Status name')} placeholder={t('Status name')} value={status.label} required maxLength={40} disabled={disabled}
                                    className="col-start-2 row-start-1 font-medium" onChange={event => change(status, { label: event.target.value })} />
                                <Input id={fieldId(status, 'description')} aria-label={t('Description')} placeholder={disabled ? undefined : t('Add a description')} value={status.description} maxLength={500} disabled={disabled}
                                    className="col-span-2 col-start-2 row-start-2 @lg/statuses:col-span-1 @lg/statuses:col-start-3 @lg/statuses:row-start-1"
                                    onChange={event => change(status, { description: event.target.value })} />
                                <div className="col-start-3 row-start-1 flex justify-end @lg/statuses:col-start-4">
                                    {!disabled && (canMoveUp || canMoveDown || canRemove) && <DropdownMenu>
                                        <DropdownMenuTrigger render={<Button id={fieldId(status, 'actions')} variant="ghost" size="icon-sm" className="text-muted-foreground pointer-coarse:size-11"
                                            aria-label={t('More actions for {value0}', { value0: name(status) })} />}>
                                            <EllipsisIcon />
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="min-w-40">
                                            <DropdownMenuGroup>
                                                <DropdownMenuItem disabled={!canMoveUp} onClick={() => move(status, -1)}><ArrowUpIcon />{t('Move up')}</DropdownMenuItem>
                                                <DropdownMenuItem disabled={!canMoveDown} onClick={() => move(status, 1)}><ArrowDownIcon />{t('Move down')}</DropdownMenuItem>
                                            </DropdownMenuGroup>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuGroup>
                                                <DropdownMenuItem variant="destructive" disabled={!canRemove} onClick={() => remove(status)}><TrashIcon />{t('Remove')}</DropdownMenuItem>
                                            </DropdownMenuGroup>
                                        </DropdownMenuContent>
                                    </DropdownMenu>}
                                </div>
                            </li>;
                        })}
                    </ul>
                    {!disabled && <Button variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground pointer-coarse:min-h-11" disabled={value.statuses.length >= MAX_STATUSES}
                        aria-label={t('Add status to {category}', { category: categoryLabel })} onClick={() => add(category)}>
                        <PlusIcon data-icon="inline-start" />{t('Add status')}</Button>}
                </FieldSet>;
            })}
        </div>
        {/* Each beside its label where there is room, the selects in one column */}
        {defaults.map(([field, label, statuses]) => <Field key={field} className="@md/field-group:grid @md/field-group:grid-cols-[minmax(0,1fr)_14rem] @md/field-group:items-center @md/field-group:gap-x-6">
            <FieldContent>
                <FieldLabel htmlFor={`${id}-${field}`}>{t(label)}</FieldLabel>
                {field === 'initialStatusId' && <FieldDescription>{t('New comments must start in Open or In progress so they appear in active feedback.')}</FieldDescription>}
            </FieldContent>
            <Select value={value[field]} items={statuses.map(status => ({ value: status.id, label: name(status) }))} disabled={disabled}
                onValueChange={next => { if (next) onChange({ ...value, [field]: next }); }}>
                <SelectTrigger id={`${id}-${field}`} className="w-full pointer-coarse:min-h-11">
                    <SelectValue>{(selected: string) => {
                        const status = statuses.find(item => item.id === selected);
                        return status && <><CategoryMark category={status.category} /><span className="truncate">{name(status)}</span></>;
                    }}</SelectValue>
                </SelectTrigger>
                <SelectContent><SelectGroup>{statuses.map(status => <SelectItem key={status.id} value={status.id} className="pointer-coarse:min-h-11">
                    <CategoryMark category={status.category} />{name(status)}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
        </Field>)}
    </FieldGroup>;
}
