import { useState, type KeyboardEvent } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import type { ChangeStyleProperty } from '../../changeProposal';
import { useMessages } from '../../i18n';
import {
    convertLength, fontWeights, formatLength, formatNumber, lengthRange, lengthStep, lengthUnits, nearestFontWeight,
    parseFontWeight, parseLength, type LengthContext, type LengthUnit
} from '../../styleValues';
import { inputFocusRingClassName } from '../@types/Comments';
import { RangeInput } from './RangeInput';

/** The value box: a number with its unit (or a weight's name) in one bordered field */
export const valueBoxClassName = (invalid: boolean) => cx(
    'flex h-8 min-w-0 shrink-0 items-center overflow-hidden rounded-md border bg-background pointer-coarse:h-11',
    invalid ? 'border-[hsl(var(--destructive))]' : 'border-input',
    inputFocusRingClassName
);
export const valueInputClassName = 'h-full w-full min-w-0 bg-transparent pl-2 text-base tabular-nums text-foreground outline-none sm:text-xs';

type FieldProps = {
    id: string;
    /** The field's full name (`Text size`): the value box and the slider are named by it */
    label: string;
    value: string;
    onChange: (value: string) => void;
    invalid: boolean;
    describedBy?: string;
    /** `data-uier-proposal-input` of the value box */
    inputKey: string;
};

const knownUnit = /^(?:px|r?em|r?lh|ch|ex|cap|ic|%|[sld]?v[whib]|[sld]?vmin|[sld]?vmax|cm|mm|q|in|pt|pc)$/i;

/** What a typed box holds: a number, with a unit when one was typed (`24px`, `1.5rem`) */
function typedLength(text: string, unit: string): string {
    const length = parseLength(text);
    if (!length || (length.unit && !knownUnit.test(length.unit))) return text.trim();
    return formatLength({ value: length.value, unit: length.unit || unit });
}

/**
 * A length (text size, padding, corner radius): a slider and a value box with its unit. Typing a unit in the box
 * (`1.5rem`) switches to it; choosing another unit converts the value with the element's font sizes. ↑ and ↓ in
 * the box step by 1px, 1/16 rem or em, or 1% (10 times that with Shift). A value that is not one length (`4px 8px`)
 * gets a plain box.
 */
export function LengthField({ id, label, value, onChange, invalid, describedBy, inputKey, property, original, context }: FieldProps & {
    property: ChangeStyleProperty;
    /** The captured value: a field for a value that is not one length is a plain box */
    original: string;
    context: LengthContext;
}) {
    const t = useMessages().proposal;
    const parsed = parseLength(value);
    const [lastUnit, setLastUnit] = useState(() => parsed?.unit || parseLength(original)?.unit || 'px');
    const unit = parsed?.unit || lastUnit;
    const [typing, setTyping] = useState<string>();
    const units: string[] = lengthUnits(property);
    if (!units.includes(unit)) units.push(unit);
    const shown = typing ?? (parsed ? formatNumber(parsed.value) : value);

    if (!parseLength(original)) {
        return <div className={valueBoxClassName(invalid)}>
            <input id={id} type="text" spellCheck={false} autoComplete="off" aria-label={label} aria-invalid={invalid || undefined}
                aria-describedby={describedBy} data-uier-proposal-input={inputKey} className={cx(valueInputClassName, 'pr-2 font-mono')}
                value={value} onChange={event => onChange(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
        </div>;
    }

    const range = lengthRange(property, unit, context);
    const emit = (next: number) => onChange(formatLength({ value: Math.max(0, next), unit }));
    const handleType = (text: string) => {
        setTyping(text);
        const typed = parseLength(text);
        if (typed?.unit && knownUnit.test(typed.unit)) setLastUnit(typed.unit.toLowerCase());
        onChange(text.trim() ? typedLength(text, unit) : '');
    };
    const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') event.preventDefault();
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const current = parseLength(shown)?.value ?? parsed?.value ?? 0;
        const next = Math.max(0, Number(formatNumber(current + lengthStep(unit) * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1))));
        setTyping(undefined);
        emit(next);
    };
    const handleUnit = (next: string) => {
        setLastUnit(next);
        setTyping(undefined);
        if (!parsed) return;
        const converted = convertLength({ value: parsed.value, unit }, next as LengthUnit, property, context);
        onChange(formatLength(converted ?? { value: parsed.value, unit: next }));
    };

    return <div className="flex min-w-0 items-center gap-2">
        <RangeInput aria-label={label} aria-valuetext={`${shown} ${unit}`} tabIndex={-1} className="flex-1"
            min={range.min} max={range.max} step={range.step} value={parsed?.value ?? range.min}
            onValueChange={next => { setTyping(undefined); emit(next); }} />
        <div className={cx(valueBoxClassName(invalid), 'w-[5.5rem]')}>
            <input id={id} type="text" inputMode="decimal" spellCheck={false} autoComplete="off" aria-label={label}
                aria-invalid={invalid || undefined} aria-describedby={describedBy} data-uier-proposal-input={inputKey}
                className={valueInputClassName} value={shown}
                onChange={event => handleType(event.target.value)} onKeyDown={handleKey} onBlur={() => setTyping(undefined)} />
            <select aria-label={t.unit(label)} value={unit} data-uier-proposal-unit={inputKey}
                className="h-full shrink-0 cursor-pointer appearance-none bg-transparent pl-1 pr-2 text-base text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground sm:text-xs"
                onChange={event => handleUnit(event.target.value)}>
                {units.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
        </div>
    </div>;
}

/** A font weight: a slider over the named weights and a box for any weight from 1 to 1000, with the nearest name */
export function WeightField({ id, label, value, onChange, invalid, describedBy, inputKey }: FieldProps) {
    const t = useMessages().proposal;
    const weight = parseFontWeight(value);
    const [typing, setTyping] = useState<string>();
    const shown = typing ?? (weight !== undefined ? String(weight) : value);
    const name = weight !== undefined ? t.weights[nearestFontWeight(weight)] : undefined;
    const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') event.preventDefault();
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const current = weight ?? 400;
        const index = fontWeights.findIndex(named => named > current);
        const next = event.key === 'ArrowUp'
            ? fontWeights[index === -1 ? fontWeights.length - 1 : index]!
            : [...fontWeights].reverse().find(named => named < current) ?? fontWeights[0];
        setTyping(undefined);
        onChange(String(next));
    };
    return <div className="flex min-w-0 items-center gap-2">
        <RangeInput aria-label={label} aria-valuetext={name ? `${weight} ${name}` : shown} tabIndex={-1} className="flex-1"
            min={100} max={900} step={100} value={weight ?? 400}
            onValueChange={next => { setTyping(undefined); onChange(String(next)); }} />
        <div className={cx(valueBoxClassName(invalid), 'w-[7.5rem]')}>
            <input id={id} type="text" inputMode="numeric" spellCheck={false} autoComplete="off" aria-label={label}
                aria-invalid={invalid || undefined} aria-describedby={describedBy} data-uier-proposal-input={inputKey}
                className={cx(valueInputClassName, 'w-12 flex-none')} value={shown}
                onChange={event => { setTyping(event.target.value); onChange(event.target.value.trim()); }}
                onKeyDown={handleKey} onBlur={() => setTyping(undefined)} />
            {name && <span aria-hidden="true" className="min-w-0 truncate pr-2 text-xs text-muted-foreground">{name}</span>}
        </div>
    </div>;
}
