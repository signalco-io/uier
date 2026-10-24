'use client';

import { useActionState, useState } from 'react';
import { Input } from '@signalco/ui-primitives/Input';
import { Button } from '@signalco/ui-primitives/Button';
import { FormMessage } from '../FormMessage';
import { MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import { UrlListInput } from './UrlListInput';
import { createProjectAction } from './actions';

export function NewProjectForm() {
    const [state, formAction, pending] = useActionState(createProjectAction, null);
    const [name, setName] = useState('');
    return (
        <form action={formAction} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <UrlListInput />
                <p className="m-0 text-sm text-muted-foreground">
                    The site you want to review. Add staging or preview addresses as well, so reviewers can open any of them.
                </p>
            </div>
            <Input
                label="Project name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_PROJECT_NAME_LENGTH}
                placeholder="Defaults to the site's domain"
                fullWidth />
            <FormMessage state={state} />
            <Button type="submit" variant="solid" size="lg" className="self-start" loading={pending}>
                Create project
            </Button>
        </form>
    );
}
