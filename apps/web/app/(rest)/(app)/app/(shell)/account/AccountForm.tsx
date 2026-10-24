'use client';

import { useActionState, useState } from 'react';
import { Input } from '@signalco/ui-primitives/Input';
import { Button } from '@signalco/ui-primitives/Button';
import { FormMessage } from '@/src/components/app/FormMessage';
import { MAX_NAME_LENGTH } from '@/src/lib/app/limits';
import { updateNameAction } from './actions';

export function AccountForm({ name }: { name: string }) {
    const [state, formAction, pending] = useActionState(updateNameAction, null);
    const [value, setValue] = useState(name);
    return (
        <form action={formAction} className="flex flex-col gap-4">
            <Input
                label="Name"
                name="name"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                required
                maxLength={MAX_NAME_LENGTH}
                autoComplete="name" />
            <p className="m-0 -mt-2 text-sm text-muted-foreground">Shown with your comments and to the people you work with.</p>
            <FormMessage state={state} />
            <Button type="submit" variant="solid" className="self-start" loading={pending}>Save</Button>
        </form>
    );
}
