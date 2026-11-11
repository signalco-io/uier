'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { useId } from 'react';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend, FieldDescription } from '@/src/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';

export function CheckList({
    label,
    options,
    value,
    onChange,
    description
}: {
    label: string;
    options: readonly { id: string; name: string }[];
    value: string[];
    onChange: (ids: string[]) => void;
    description?: string;
}) {
    const { t } = useAppI18n();
    const prefix = useId();
    return (
        <FieldSet>
            <FieldLegend variant="label">{label}</FieldLegend>
            {description && <FieldDescription>{description}</FieldDescription>}
            <FieldGroup className="max-h-64 gap-3 overflow-y-auto rounded-lg border p-4">
                {options.length ? (
                    options.map((option) => (
                        <Field key={option.id} orientation="horizontal">
                            <Checkbox
                                id={`${prefix}-${option.id}`}
                                checked={value.includes(option.id)}
                                onCheckedChange={(checked) =>
                                    onChange(
                                        checked === true
                                            ? [...new Set([...value, option.id])]
                                            : value.filter((id) => id !== option.id)
                                    )
                                }
                            />
                            <FieldLabel htmlFor={`${prefix}-${option.id}`} className="min-w-0 break-words font-normal">
                                {option.name}
                            </FieldLabel>
                        </Field>
                    ))
                ) : (
                    <FieldDescription>{t("No choices yet.")}</FieldDescription>
                )}
            </FieldGroup>
        </FieldSet>
    );
}

export function Choice({
    label,
    value,
    options,
    onChange
}: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    const { t } = useAppI18n();
    const id = useId();
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Select items={options} value={value} onValueChange={next => next !== null && onChange(next)}>
                <SelectTrigger id={id}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {t(option.label)}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </Field>
    );
}

/**
 * A button that does not apply here: dimmed but still focusable, with why in its tooltip (a disabled button gets no
 * hover or focus). Base UI tooltips are visual only, so the reason is also the button's description.
 */
export function UnavailableButton({ label, accessibleName, reason }: { label: string; accessibleName?: string; reason: string }) {
    const reasonId = useId();
    return (
        <>
            <Tooltip>
                <TooltipTrigger render={<Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-disabled="true"
                    aria-label={accessibleName}
                    aria-describedby={reasonId}
                    className="cursor-not-allowed opacity-50 hover:bg-background active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-input/30" />}>
                    {label}
                </TooltipTrigger>
                <TooltipContent>{reason}</TooltipContent>
            </Tooltip>
            <span id={reasonId} className="sr-only">{reason}</span>
        </>
    );
}
