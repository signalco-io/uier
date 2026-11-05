'use client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { CardContent, CardFooter } from '@/src/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '../FormMessage';
import { MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import { defaultProjectName, normalizeSiteUrl } from '../../../lib/app/siteUrl';
import { ClientNameInput } from './ClientNameInput';
import { UrlListInput } from './UrlListInput';
import { createProjectAction } from './actions';

/** The name a project gets from its main address when the name is left empty (as the server derives it) */
function derivedName(mainUrl: string | undefined) {
    const url = normalizeSiteUrl(mainUrl ?? '');
    return url ? defaultProjectName(url) : undefined;
}

/**
 * The fields and footer of the new-project card; `clients` are the existing ones to suggest. The name's
 * placeholder is the name the main address gives it, as it is typed.
 */
export function NewProjectForm({ clients }: { clients: string[] }) {
    const id = useId();
    const [state, formAction, pending] = useActionState(createProjectAction, null);
    const [name, setName] = useState('');
    const [clientName, setClientName] = useState('');
    const [mainUrl, setMainUrl] = useState<string>();
    return (
        <form action={formAction} className="flex flex-col gap-6">
            <CardContent>
                <FieldGroup>
                    <UrlListInput
                        description="The site you want to review first, then any staging or preview addresses, so reviewers can open any of them."
                        onUrlsChange={urls => setMainUrl(urls[0])} />
                    <Field>
                        <FieldLabel htmlFor={`${id}-name`}>Project name</FieldLabel>
                        <Input
                            id={`${id}-name`}
                            name="name"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            maxLength={MAX_PROJECT_NAME_LENGTH}
                            placeholder={derivedName(mainUrl) ?? 'Defaults to the site\'s domain'} />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor={`${id}-client`}>Client name (optional)</FieldLabel>
                        <ClientNameInput id={`${id}-client`} value={clientName} onValueChange={setClientName} clients={clients} />
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
