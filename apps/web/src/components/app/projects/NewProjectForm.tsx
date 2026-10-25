'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { CardContent, CardFooter } from '@/src/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '../FormMessage';
import { MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import { UrlListInput } from './UrlListInput';
import { createProjectAction } from './actions';

/** The fields and footer of the new-project card */
export function NewProjectForm() {
    const id = useId();
    const [state, formAction, pending] = useActionState(createProjectAction, null);
    const [name, setName] = useState('');
    return (
        <form action={formAction} className="flex flex-col gap-6">
            <CardContent>
                <FieldGroup>
                    <UrlListInput />
                    <FieldDescription className="-mt-3">
                        The site you want to review. Add staging or preview addresses as well, so reviewers can open any of them.
                    </FieldDescription>
                    <Field>
                        <FieldLabel htmlFor={`${id}-name`}>Project name</FieldLabel>
                        <Input
                            id={`${id}-name`}
                            name="name"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            maxLength={MAX_PROJECT_NAME_LENGTH}
                            placeholder="Defaults to the site's domain" />
                    </Field>
                </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end gap-3 border-t">
                <FormMessage state={state} className="mr-auto" />
                <Button type="submit" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    Create project
                </Button>
            </CardFooter>
        </form>
    );
}
