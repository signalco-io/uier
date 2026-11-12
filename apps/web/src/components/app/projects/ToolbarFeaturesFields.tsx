'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useId } from 'react';
import { toolbarFeatures, type ToolbarFeatureVisibility } from '@uier/toolbar/toolbar-features';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldGroup } from '@/src/components/ui/field';

const labels = { accessibility: 'Accessibility', seo: 'SEO', rewrite: 'Text rewrites', draw: 'Drawing on the page' };

export function ToolbarFeaturesFields({ value, onChange, guests, disabled }: {
    value: ToolbarFeatureVisibility;
    onChange: (value: ToolbarFeatureVisibility) => void;
    guests: boolean;
    disabled: boolean;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const choices = (signedOut: boolean) => {
        const key = signedOut ? "signedOut" : 'enabled';
        const selected = value[key];
        const allId = `${id}-${key}`;
        return <FieldSet className="gap-3" disabled={disabled}>
            <FieldLegend variant="label">{signedOut ? t("Signed-out reviewers") : t("Project tools")}</FieldLegend>
            <Field orientation="horizontal">
                <Checkbox id={allId} checked={selected === undefined} onCheckedChange={all => {
                    const next = { ...value };
                    if (all) delete next[key];
                    else next[key] = [...toolbarFeatures];
                    onChange(next);
                }} />
                <FieldLabel htmlFor={allId}>{signedOut ? t("Follow project tools") : t("Show all current and future tools")}</FieldLabel>
            </Field>
            <FieldDescription>{signedOut
                ? t("Choose a smaller set for people who are not signed in. Only tools enabled for the project can appear.")
                : t("Customize the list to keep new tools hidden until you enable them. Comments, page feedback and the inbox stay available.")}</FieldDescription>
            {selected !== undefined && <FieldGroup className="gap-3 pl-6">
                {toolbarFeatures.map(feature => <Field key={feature} orientation="horizontal">
                    <Checkbox id={`${allId}-${feature}`} checked={selected.includes(feature) && (!signedOut || value.enabled === undefined || value.enabled.includes(feature))}
                        disabled={disabled || (signedOut && value.enabled !== undefined && !value.enabled.includes(feature))}
                        onCheckedChange={checked => onChange({ ...value, [key]: toolbarFeatures.filter(item => item === feature ? checked : selected.includes(item)) })} />
                    <FieldLabel htmlFor={`${allId}-${feature}`}>{t(labels[feature])}</FieldLabel>
                </Field>)}
            </FieldGroup>}
        </FieldSet>;
    };
    return <FieldSet>
        <FieldLegend variant="label">{t("Toolbar features")}</FieldLegend>
        <FieldDescription>{t("Choose the tools reviewers see. This changes toolbar visibility; existing project permissions still apply.")}</FieldDescription>
        {choices(false)}
        {guests && choices(true)}
    </FieldSet>;
}
