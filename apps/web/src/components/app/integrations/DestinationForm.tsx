'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/src/components/ui/button';

/**
 * Where a connection's destination is chosen: the form is open until a destination is saved and afterwards
 * behind the Change action of its row in the details. Closing it returns the focus to that action, or to the
 * details that now name the first destination.
 */
export function useDestinationForm(saved: boolean) {
    const id = `${useId()}-destination`;
    const trigger = useRef<HTMLButtonElement>(null);
    const details = useRef<HTMLDListElement>(null);
    const [editing, setEditing] = useState(false);
    return {
        id, trigger, details, editing,
        open: editing || !saved,
        edit: () => setEditing(true),
        close() {
            (trigger.current ?? details.current)?.focus();
            setEditing(false);
        }
    };
}
export type DestinationForm = ReturnType<typeof useDestinationForm>;

/** The Change action of a destination's row; it says whether its form is open */
export function ChangeDestinationButton({ form, onClick, children }: { form: DestinationForm; onClick: () => void; children: ReactNode }) {
    return <Button ref={form.trigger} type="button" variant="outline" size="sm" aria-expanded={form.editing}
        aria-controls={form.editing ? form.id : undefined} onClick={onClick}>{children}</Button>;
}

/** The destination form's panel, under the details; `form` names it for the Change action that opens it */
export function DestinationPanel({ form, children }: { form?: DestinationForm; children: ReactNode }) {
    return <div id={form?.id} className="flex flex-col gap-5 rounded-lg border p-4">{children}</div>;
}
