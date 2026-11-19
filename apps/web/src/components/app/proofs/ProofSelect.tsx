'use client';

import { cn } from '@/src/lib/utils';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';

export function ProofSelect({ id, label, value, items, onChange, className, disabled }: {
    id?: string;
    label: string;
    value: string;
    items: { value: string; label: string }[];
    onChange: (value: string) => void;
    className?: string;
    disabled?: boolean;
}) {
    return (
        <Select value={value} items={items} onValueChange={next => { if (next !== null) onChange(next); }} disabled={disabled}>
            <SelectTrigger id={id} aria-label={label} className={cn("pointer-coarse:min-h-11", className)}><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
                {items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectGroup></SelectContent>
        </Select>
    );
}
