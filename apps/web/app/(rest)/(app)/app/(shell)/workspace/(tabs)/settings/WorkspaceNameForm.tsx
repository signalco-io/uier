'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { Section } from '@/src/components/app/PageHeader';
import { MAX_WORKSPACE_NAME_LENGTH } from '@/src/lib/app/limits';
import { renameWorkspaceAction } from './actions';

export function WorkspaceNameForm({ name }: { name: string }) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(renameWorkspaceAction, null);
    const [value, setValue] = useState(name);
    return (
        <Section
            id="general"
            title="General"
            footer={(
                <>
                    <FormMessage state={state} className="mr-auto" />
                    <Button type="submit" form={formId} disabled={pending}>
                        {pending && <Spinner data-icon="inline-start" />}
                        Save
                    </Button>
                </>
            )}>
            <form id={formId} action={formAction}>
                <Field>
                    <FieldLabel htmlFor={`${formId}-name`}>Workspace name</FieldLabel>
                    <Input
                        id={`${formId}-name`}
                        name="name"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        required
                        maxLength={MAX_WORKSPACE_NAME_LENGTH}
                        className="max-w-md" />
                    <FieldDescription>Everyone in the workspace sees it in the workspace menu, and when they connect a coding tool.</FieldDescription>
                </Field>
            </form>
        </Section>
    );
}
