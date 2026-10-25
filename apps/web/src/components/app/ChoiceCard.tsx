import type { ReactNode } from 'react';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/src/components/ui/field';
import { RadioGroupItem } from '@/src/components/ui/radio-group';

/**
 * One option of a `RadioGroup` as a card: the title, a description and the radio. The radio is
 * named by the title and described by the description (a wrapping label alone names it with nothing).
 */
export function ChoiceCard({ id, value, title, description, icon }: {
    id: string;
    value: string;
    title: ReactNode;
    description: ReactNode;
    icon?: ReactNode;
}) {
    return (
        <FieldLabel htmlFor={id}>
            <Field orientation="horizontal">
                {icon}
                <FieldContent>
                    <FieldTitle id={`${id}-title`}>{title}</FieldTitle>
                    <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
                </FieldContent>
                <RadioGroupItem value={value} id={id} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} />
            </Field>
        </FieldLabel>
    );
}
