'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useId, useState } from 'react';
import { Button } from '@/src/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { FormMessage } from '@/src/components/app/FormMessage';
import { requestSignInAction } from '../../actions';
import { SignInCodeForm } from '../../SignInForm';

/** Microsoft's email claim is an editable suggestion; the code proves the chosen inbox. */
export function MicrosoftLinkForm({ email: suggestedEmail, next }: { email: string; next?: string }) {
    const { t } = useAppI18n();
    const id = useId();
    const [email, setEmail] = useState(suggestedEmail);
    const [state, formAction, pending] = useActionState(requestSignInAction, null);
    if (state?.ok) return <SignInCodeForm addingAccount key={state.data.requestId} sent={state.data} next={next} />;
    return (
        <form action={formAction}>
            <input type="hidden" name="linkProvider" value="microsoft" />
            {next && <input type="hidden" name="next" value={next} />}
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={id}>{t("Email")}</FieldLabel>
                    <Input id={id} name="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
                </Field>
                <FormMessage state={state} />
                <Button type="submit" size="lg" className="w-full" disabled={pending}>
                    {pending && <Spinner data-icon="inline-start" />}
                    {t("Email me a sign-in code")}{' '}</Button>
            </FieldGroup>
        </form>
    );
}
