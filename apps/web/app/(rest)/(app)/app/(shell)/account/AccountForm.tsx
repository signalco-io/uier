'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Spinner } from '@/src/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { FormMessage } from '@/src/components/app/FormMessage';
import { Section } from '@/src/components/app/PageHeader';
import { themeOptions } from '@/src/components/app/shell/AccountMenu';
import { MAX_NAME_LENGTH } from '@/src/lib/app/limits';
import { updateNameAction } from './actions';

export function AccountForm({ name }: { name: string }) {
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateNameAction, null);
    const [value, setValue] = useState(name);
    return (
        <Section
            id="profile"
            title="Profile"
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
                    <FieldLabel htmlFor={`${formId}-name`}>Name</FieldLabel>
                    <Input
                        id={`${formId}-name`}
                        name="name"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        required
                        maxLength={MAX_NAME_LENGTH}
                        autoComplete="name"
                        className="max-w-md" />
                    <FieldDescription>Shown with your comments and to the people you work with.</FieldDescription>
                </Field>
            </form>
        </Section>
    );
}

/** Light, dark or the system's theme for the app (and the site), kept in this browser */
export function AppearanceSection() {
    const { theme, setTheme } = useTheme();
    // next-themes only knows the theme on the client; show "system" until mounted
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    return (
        <Section id="appearance" title="Appearance" description="How uier looks in this browser.">
            <ToggleGroup
                type="single"
                variant="outline"
                aria-label="Theme"
                value={mounted ? (theme ?? 'system') : 'system'}
                onValueChange={(next) => next && setTheme(next)}>
                {themeOptions.map(option => (
                    <ToggleGroupItem key={option.value} value={option.value} className="px-3">
                        <option.icon data-icon="inline-start" />
                        {option.label}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </Section>
    );
}
