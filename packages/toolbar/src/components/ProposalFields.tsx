import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Input } from '@signalco/ui-primitives/Input';
import { changeProposalTextMaxLength, changeStyleProperties, isChangeProposal, isChangeStyleValue, type ChangeProposal, type ChangeStyleProperty } from '../changeProposal';
import { useMessages } from '../i18n';
import { destructiveTextClassName, inputFocusRingClassName } from './@types/Comments';

export type ProposalTarget = { text?: string; styles: Partial<Record<ChangeStyleProperty, string>> };
const paddingProperties = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] as const;
const mainProperties = changeStyleProperties.filter(property => !property.startsWith('padding-'));
const inputClassName = `min-w-0 [&>input]:text-base sm:[&>input]:text-sm pointer-coarse:[&>input]:min-h-11 ${inputFocusRingClassName}`;

function pickerColor(value: string) {
    const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value)?.[1];
    if (hex) return `#${hex.length < 5 ? [...hex.slice(0, 3)].map(digit => digit.repeat(2)).join('') : hex.slice(0, 6)}`;
    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/.exec(value);
    return rgb ? `#${rgb.slice(1, 4).map(channel => Math.min(255, Number(channel)).toString(16).padStart(2, '0')).join('')}` : undefined;
}

/** Keep editable input values separately so incomplete CSS can be corrected before saving. */
export function buildElementProposal(original: ProposalTarget, values: ProposalTarget) {
    const styles: ChangeProposal['styles'] = {};
    const invalid: (ChangeStyleProperty | 'text')[] = [];
    for (const property of changeStyleProperties) {
        const before = original.styles[property];
        const after = values.styles[property]?.trim();
        if (before === undefined || after === undefined || before === after) continue;
        const change = { original: before, proposed: after };
        if (isChangeProposal({ styles: { [property]: change } }) && CSS.supports(property, after)) styles[property] = change;
        else invalid.push(property);
    }
    const proposal: ChangeProposal = { styles };
    if (original.text !== undefined && values.text !== undefined && original.text !== values.text) {
        const text = { original: original.text, proposed: values.text };
        if (isChangeProposal({ text, styles: {} })) proposal.text = text;
        else invalid.push('text');
    }
    return { proposal: isChangeProposal(proposal) ? proposal : undefined, invalid };
}

export function proposalValues(proposal: ChangeProposal, side: 'original' | 'proposed'): ProposalTarget {
    const styles: ProposalTarget['styles'] = {};
    for (const property of changeStyleProperties) {
        const change = proposal.styles[property];
        if (change) styles[property] = change[side];
    }
    return { text: proposal.text?.[side], styles };
}

export function ProposalFields({ original, values, invalid, onChange, children }: {
    original: ProposalTarget;
    values: ProposalTarget;
    invalid: (ChangeStyleProperty | 'text')[];
    onChange: (values: ProposalTarget) => void;
    children: ReactNode;
}) {
    const t = useMessages().proposal;
    const id = useId();
    const section = useRef<HTMLElement>(null);
    useLayoutEffect(() => { section.current?.focus({ preventScroll: true }); }, []);
    const updateStyle = (property: ChangeStyleProperty, value: string) =>
        onChange({ ...values, styles: { ...values.styles, [property]: value } });
    const styleField = (property: ChangeStyleProperty) => {
        const before = original.styles[property];
        if (before === undefined) return null;
        const value = values.styles[property] ?? before;
        const bad = invalid.includes(property);
        const color = property === 'color' || property === 'background-color';
        const swatch = color && (isChangeStyleValue(property, value) ? value : before);
        return <div key={property} className="grid min-w-0 content-start gap-1">
            <div className={color ? 'grid min-w-0 grid-cols-[minmax(0,1fr)_44px] items-end gap-1' : 'min-w-0'}>
                <Input label={t.properties[property]} title={property} data-uier-proposal-input={property}
                    fullWidth spellCheck={false} autoComplete="off" value={value} maxLength={128}
                    aria-invalid={bad || undefined} aria-describedby={`${id}-${property}${bad ? ` ${id}-invalid` : ''}`}
                    className={inputClassName} onChange={event => updateStyle(property, event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
                {swatch && <div className="relative">
                    <Input type="color" aria-label={t.chooseColor(t.properties[property])} value={pickerColor(swatch) ?? '#000000'}
                        data-uier-proposal-color={property} className={`w-11 [&>input]:cursor-pointer [&>input]:opacity-0 ${inputClassName}`}
                        onChange={event => updateStyle(property, event.target.value)} />
                    <span aria-hidden="true" className="pointer-events-none absolute inset-x-2 inset-y-2.5 rounded-sm border border-border bg-background"
                        style={{ backgroundColor: swatch }} />
                </div>}
            </div>
            <span id={`${id}-${property}`} className="min-w-0 break-words text-xs text-muted-foreground">
                {t.original} <code className="select-text font-mono">{before}</code>
            </span>
        </div>;
    };
    const originalLeft = original.styles['padding-left'];
    const originalRight = original.styles['padding-right'];
    const left = values.styles['padding-left'] ?? originalLeft;
    const right = values.styles['padding-right'] ?? originalRight;
    const sideInvalid = invalid.includes('padding-left') || invalid.includes('padding-right');
    return <section ref={section} aria-label={t.suggest} tabIndex={-1} data-uier-proposal-editor="" className="grid gap-2 border-b pb-3 focus:outline-none">
        {children}
        {original.text !== undefined && <div className="grid gap-1 text-xs font-medium">
            <label htmlFor={`${id}-replacement`}>{t.text}</label>
            <textarea id={`${id}-replacement`} data-uier-proposal-input="text" value={values.text ?? original.text} rows={2}
                maxLength={changeProposalTextMaxLength} aria-invalid={invalid.includes('text') || undefined}
                aria-describedby={`${id}-text${invalid.includes('text') ? ` ${id}-invalid` : ''}`}
                className={`min-h-11 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base font-normal sm:text-sm ${inputFocusRingClassName}`}
                onChange={event => onChange({ ...values, text: event.target.value })} />
            <span id={`${id}-text`} className="whitespace-pre-wrap break-words text-xs font-normal text-muted-foreground">
                {t.original} <span className="select-text">{original.text || t.empty}</span>
            </span>
        </div>}
        <div className="grid grid-cols-2 gap-3">
            {mainProperties.map(styleField)}
            {originalLeft !== undefined && originalRight !== undefined && <div className="grid min-w-0 content-start gap-1">
                <Input label={t.sidePadding} data-uier-proposal-input="side-padding" fullWidth spellCheck={false} autoComplete="off"
                    value={left === right ? left : ''} placeholder={left !== right ? t.mixedValues : undefined} maxLength={128}
                    aria-invalid={sideInvalid || undefined} aria-describedby={`${id}-side-padding${sideInvalid ? ` ${id}-invalid` : ''}`}
                    className={inputClassName} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
                    onChange={event => {
                        const value = event.target.value;
                        onChange({ ...values, styles: { ...values.styles, 'padding-left': value, 'padding-right': value } });
                    }} />
                <span id={`${id}-side-padding`} className="min-w-0 break-words text-xs text-muted-foreground">
                    {t.original} {originalLeft === originalRight
                        ? <code className="select-text font-mono">{originalLeft}</code>
                        : <><code className="select-text font-mono">{originalLeft}</code> / <code className="select-text font-mono">{originalRight}</code></>}
                </span>
            </div>}
        </div>
        {paddingProperties.some(property => original.styles[property] !== undefined) && <details data-uier-proposal-padding-details="">
            <summary className="min-h-8 cursor-pointer rounded-sm text-xs font-medium leading-8 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11 pointer-coarse:leading-11">{t.paddingDetails}</summary>
            <div className="grid grid-cols-2 gap-3 pt-1">{paddingProperties.map(styleField)}</div>
        </details>}
        {invalid.length > 0 && <p id={`${id}-invalid`} role="status" className={`m-0 text-xs ${destructiveTextClassName}`}>{t.invalid}</p>}
    </section>;
}
