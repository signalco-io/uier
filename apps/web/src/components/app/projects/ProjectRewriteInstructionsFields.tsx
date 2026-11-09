'use client';

import { useId } from 'react';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Textarea } from '@/src/components/ui/textarea';
import { projectSettingModes, type ProjectSettingMode } from '@/src/lib/app/inheritedSettings';
import { effectiveRewriteInstructions, MAX_REWRITE_INSTRUCTIONS_LENGTH } from '@/src/lib/rewrite/settings';

const modeOptions = [
    { value: 'workspace', label: 'Workspace default' },
    { value: 'append', label: 'Add to workspace instructions' },
    { value: 'replace', label: 'Replace workspace instructions' }
];

/** Part of General's single draft and save. Only its admin page supplies these values. */
export function ProjectRewriteInstructionsFields({ mode, value, workspace, onModeChange, onValueChange, disabled }: {
    mode: ProjectSettingMode; value: string; workspace: string; disabled: boolean;
    onModeChange: (mode: ProjectSettingMode) => void; onValueChange: (value: string) => void;
}) {
    const id = useId();
    const effective = effectiveRewriteInstructions({ rewriteInstructions: workspace }, {
        rewriteInstructions: mode === 'workspace' ? undefined : { mode, value }
    });
    return (
        <FieldSet>
            <FieldLegend variant="label">Rewrite suggestions</FieldLegend>
            <FieldDescription>Tone, preferred terms and writing style for AI copy suggestions. Only admins can see or change these settings.</FieldDescription>
            <FieldGroup>
                <Field>
                    <FieldLabel htmlFor={`${id}-mode`}>Rewrite instructions</FieldLabel>
                    <input type="hidden" name="rewriteInstructionsMode" value={mode} />
                    <input type="hidden" name="rewriteInstructions" value={value} />
                    <Select value={mode} items={modeOptions} disabled={disabled}
                        onValueChange={next => { if (projectSettingModes.some(item => item === next)) onModeChange(next as ProjectSettingMode); }}>
                        <SelectTrigger id={`${id}-mode`} className="w-full max-w-md"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {modeOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <FieldDescription>Add puts project instructions after the workspace instructions. Replace uses only this project&apos;s instructions, even when empty.</FieldDescription>
                </Field>
                {mode !== 'workspace' && <Field>
                    <FieldLabel htmlFor={`${id}-instructions`}>Project rewrite instructions</FieldLabel>
                    <Textarea id={`${id}-instructions`} value={value} onChange={event => onValueChange(event.target.value)}
                        maxLength={MAX_REWRITE_INSTRUCTIONS_LENGTH} rows={5} disabled={disabled} aria-describedby={`${id}-limit`}
                        placeholder="Use short sentences. Call people members, not users." />
                    <FieldDescription id={`${id}-limit`}>Up to {MAX_REWRITE_INSTRUCTIONS_LENGTH.toLocaleString('en')} characters. Style guidance cannot change the model&apos;s rules or response format.</FieldDescription>
                </Field>}
                <div className="min-w-0 text-sm">
                    <p className="m-0 font-medium">Effective instructions</p>
                    <p className="mt-2 mb-0 whitespace-pre-wrap wrap-anywhere rounded-lg border bg-muted p-3 text-muted-foreground">{effective || 'No additional style guidance.'}</p>
                    <p className="mt-2 mb-0 text-muted-foreground">Sent to Anthropic with each rewrite request. Workspace changes apply whenever this project follows or adds to them.</p>
                </div>
            </FieldGroup>
        </FieldSet>
    );
}
