'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { createContext, useActionState, useContext, useId, useState, type ReactNode } from 'react';
import { Button } from '@/src/components/ui/button';
import { CardContent, CardFooter } from '@/src/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/src/components/ui/radio-group';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '../FormMessage';
import { Bar, Loading } from '../loading/outlines';
import { MAX_PROJECT_NAME_LENGTH } from '../../../lib/app/limits';
import { defaultProjectName, normalizeSiteUrl } from '../../../lib/app/siteUrl';
import { ClientNameInput } from './ClientNameInput';
import { UrlListInput } from './UrlListInput';
import { useNewProjectMode } from './NewProjectMode';
import { createProjectAction } from './actions';

/** The name a project gets from its main address when the name is left empty (as the server derives it) */
function derivedName(mainUrl: string | undefined) {
    const url = normalizeSiteUrl(mainUrl ?? '');
    return url ? defaultProjectName(url) : undefined;
}

/** What the parts that arrive later (`client`, `submit`) need from the form they sit in */
const NewProjectFormContext = createContext({ clientId: '', pending: false });

/**
 * The fields and footer of the new-project card. The addresses and the name need no data, so the form is in the
 * page's shell and can be filled in at once (docs/design/loading-states #6); what waits for the request comes in
 * through two slots and keeps what was typed: `client`, the client field's control (`NewProjectClient`, which
 * suggests the workspace's clients), and `submit`, the button (`NewProjectSubmit`), which the page enables only once
 * it has authorized the person. The name's placeholder is the name the main address gives it, as it is typed.
 */
export function NewProjectForm({ client, submit }: { client: ReactNode; submit: ReactNode }) {
    const { t } = useAppI18n();
    const id = useId();
    const [state, formAction, pending] = useActionState(createProjectAction, null);
    const { mode, setMode } = useNewProjectMode();
    const [name, setName] = useState('');
    const [mainUrl, setMainUrl] = useState<string>();
    return (
        <NewProjectFormContext.Provider value={{ clientId: `${id}-client`, pending }}>
        <form action={formAction} className="flex flex-col gap-6">
            <CardContent>
                <FieldGroup>
                    <Field>
                        <FieldLabel id={`${id}-mode`}>{t("What will you review?")}</FieldLabel>
                        <input type="hidden" name="mode" value={mode} />
                        <RadioGroup aria-labelledby={`${id}-mode`} className="flex flex-wrap gap-4" value={mode}
                            onValueChange={value => setMode(value === 'files' ? 'files' : 'website')}>
                            <FieldLabel className="gap-2"><RadioGroupItem value="website" />{t("Website")}</FieldLabel>
                            <FieldLabel className="gap-2"><RadioGroupItem value="files" />{t("Files only")}</FieldLabel>
                        </RadioGroup>
                    </Field>
                    <div hidden={mode === 'files'}>
                        <UrlListInput
                            enabled={mode === 'website'}
                            description={t("The site you want to review first, then any staging or preview addresses, so reviewers can open any of them.")}
                            onUrlsChange={urls => setMainUrl(urls[0])} />
                    </div>
                    <Field>
                        <FieldLabel htmlFor={`${id}-name`}>{t("Project name")}</FieldLabel>
                        <Input
                            id={`${id}-name`}
                            name="name"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            maxLength={MAX_PROJECT_NAME_LENGTH}
                            required={mode === 'files'}
                            placeholder={mode === 'website' ? derivedName(mainUrl) ?? t("Defaults to the site's domain") : undefined} />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor={`${id}-client`}>{t("Client name (optional)")}</FieldLabel>
                        {client}
                    </Field>
                </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end gap-3 border-t">
                <FormMessage state={state} className="mr-auto" />
                {submit}
            </CardFooter>
        </form>
        </NewProjectFormContext.Provider>
    );
}

/**
 * The client field's control: free text that suggests `clients`, the existing ones. A workspace with clients gets
 * another control than one without (`ClientNameInput`), so it is drawn once they are read.
 */
export function NewProjectClient({ clients }: { clients: string[] }) {
    const { clientId } = useContext(NewProjectFormContext);
    const [clientName, setClientName] = useState('');
    return <ClientNameInput id={clientId} value={clientName} onValueChange={setClientName} clients={clients} />;
}

/** The control's place until then, and the form's one status */
export function NewProjectClientLoading() {
    return <Loading label="Loading the form"><Bar className="h-9 w-full" /></Loading>;
}

/** Create project, the form's button. Not `authorized`: disabled, while the page has yet to authorize the person */
export function NewProjectSubmit({ authorized = true }: { authorized?: boolean }) {
    const { t } = useAppI18n();
    const { pending } = useContext(NewProjectFormContext);
    return (
        <Button type="submit" disabled={pending || !authorized}>
            {pending && <Spinner data-icon="inline-start" />}{t("Create project")}</Button>
    );
}
