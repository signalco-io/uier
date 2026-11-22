import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { AI, Down, Link, LinkOff, Reset, Up } from '@signalco/ui-icons';
import { changeProposalTextMaxLength, type ChangeStyleProperty } from '../changeProposal';
import { proposalEdits, type ProposalTarget } from '../proposalDraft';
import type { ProposalElement } from '../proposalPreview';
import { defaultLengthContext, displayColor, displayStyleValue, isColorProperty } from '../styleValues';
import { useMessages } from '../i18n';
import { destructiveTextClassName, inputFocusRingClassName } from './@types/Comments';
import { IconTooltip } from './IconTooltip';
import { RewriteSuggestions, type useRewriteSuggestionsState } from './RewriteSuggestions';
import { ColorField } from './proposal/ColorField';
import { LengthField, WeightField } from './proposal/NumberFields';

type FieldKey = ChangeStyleProperty | 'text' | 'padding-block' | 'padding-inline';

const textStyle: ChangeStyleProperty[] = ['font-size', 'font-weight', 'color'];
const boxStyle: ChangeStyleProperty[] = ['background-color', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-radius'];
const axes = [
    ['padding-block', 'padding-top', 'padding-bottom'],
    ['padding-inline', 'padding-left', 'padding-right']
] as const;

/**
 * The element suggestion's fields (docs/composer-popovers.md#an-element-suggestion), grouped: Content (the text,
 * with AI wording help), Text style (size, weight, colour) and Background and spacing (fill, padding, corners).
 * A text element (a heading, a paragraph) keeps the last group behind More properties until one of its values
 * changes. Each changed field shows a dot, its original ("was 6px") and Reset; an invalid one says what it needs.
 */
export function ProposalFields({ original, values, invalid, onChange, element, suggestions }: {
    original: ProposalTarget;
    values: ProposalTarget;
    invalid: (ChangeStyleProperty | 'text')[];
    onChange: (values: ProposalTarget) => void;
    /** The element as it is now: its kind and its units' font sizes; `null` when it can't be read */
    element: ProposalElement | null;
    /** AI wording for the text, where the project offers rewrites */
    suggestions?: ReturnType<typeof useRewriteSuggestionsState>;
}) {
    const t = useMessages().proposal;
    const id = useId();
    const section = useRef<HTMLElement>(null);
    useLayoutEffect(() => { section.current?.focus({ preventScroll: true }); }, []);
    const context = element?.context ?? defaultLengthContext;
    const edits = proposalEdits({ original, values });
    const value = (property: ChangeStyleProperty) => values.styles[property] ?? original.styles[property] ?? '';
    const hasPadding = axes.every(([, first, second]) => original.styles[first] !== undefined && original.styles[second] !== undefined);
    const [eachSide, setEachSide] = useState(() => hasPadding && axes.some(([, first, second]) => value(first) !== value(second)));
    const boxEdited = boxStyle.some(property => edits.includes(property) || invalid.includes(property));
    const [more, setMore] = useState(false);
    const showBox = (element?.box ?? true) || more || boxEdited;
    const [wording, setWording] = useState(false);

    const setStyles = (styles: ProposalTarget['styles']) => onChange({ ...values, styles: { ...values.styles, ...styles } });
    const reset = (properties: readonly ChangeStyleProperty[]) =>
        setStyles(Object.fromEntries(properties.map(property => [property, original.styles[property]!])));
    const shown = (property: ChangeStyleProperty, written: string) => {
        if (!isColorProperty(property)) return displayStyleValue(property, written);
        const color = displayColor(written);
        return color === 'transparent' ? t.transparent : color;
    };
    const errorFor = (key: ChangeStyleProperty | 'text') => key === 'text' ? t.invalidText
        : isColorProperty(key) ? t.invalidColor : key === 'font-weight' ? t.invalidWeight : t.invalidLength;
    const describedBy = (fieldId: string, changed: boolean, bad: boolean) =>
        [changed && `${fieldId}-was`, bad && `${fieldId}-error`].filter(Boolean).join(' ') || undefined;

    const styleField = (property: ChangeStyleProperty) => {
        const before = original.styles[property];
        if (before === undefined) return null;
        const fieldId = `${id}-${property}`;
        const changed = edits.includes(property);
        const bad = invalid.includes(property);
        const common = {
            id: fieldId,
            label: t.properties[property],
            value: value(property),
            invalid: bad,
            describedBy: describedBy(fieldId, changed, bad),
            onChange: (next: string) => setStyles({ [property]: next })
        };
        return <FieldRow key={property} fieldKey={property} fieldId={fieldId} label={t.labels[property]} changed={changed}
            was={shown(property, before)} error={bad ? errorFor(property) : undefined}
            resetLabel={t.reset(t.properties[property])} onReset={() => reset([property])}>
            {isColorProperty(property)
                ? <ColorField {...common} property={property} />
                : property === 'font-weight'
                    ? <WeightField {...common} inputKey={property} />
                    : <LengthField {...common} inputKey={property} property={property} original={before} context={context} />}
        </FieldRow>;
    };

    const axisField = ([key, first, second]: typeof axes[number]) => {
        const fieldId = `${id}-${key}`;
        const changed = edits.includes(first) || edits.includes(second);
        const bad = invalid.includes(first) || invalid.includes(second);
        const before = original.styles[first]!;
        const after = original.styles[second]!;
        return <FieldRow key={key} fieldKey={key} fieldId={fieldId} label={t.labels[key]} changed={changed}
            was={before === after ? shown(first, before) : `${shown(first, before)} / ${shown(second, after)}`} error={bad ? t.invalidLength : undefined}
            resetLabel={t.reset(t.properties[key])} onReset={() => reset([first, second])}>
            <LengthField id={fieldId} inputKey={key} label={t.properties[key]} property={first} original={before} context={context}
                value={value(first)} invalid={bad} describedBy={describedBy(fieldId, changed, bad)}
                onChange={next => setStyles({ [first]: next, [second]: next })} />
        </FieldRow>;
    };

    const toggleSides = () => {
        // Back to one value per axis: the top and left values apply to their opposite sides, as the page shows
        if (eachSide) setStyles(Object.fromEntries(axes.flatMap(([, first, second]) => value(first) === value(second) ? [] : [[second, value(first)]])));
        setEachSide(!eachSide);
    };

    const textId = `${id}-text`;
    const textChanged = edits.includes('text');
    const textBad = invalid.includes('text');
    const text = values.text ?? original.text ?? '';

    return <section ref={section} aria-label={t.suggest} tabIndex={-1} data-uier-proposal-editor="" className="grid gap-4 pb-1 focus:outline-none">
        {original.text !== undefined && <FieldGroup title={t.groups.content} action={suggestions && <IconTooltip label={t.suggestWording}>
            <IconButton variant={wording ? 'soft' : 'plain'} size="xs" type="button" aria-label={t.suggestWording} aria-pressed={wording}
                data-uier-proposal-wording="" className="size-7 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                onClick={() => setWording(!wording)}>
                <AI size={14} aria-hidden="true" />
            </IconButton>
        </IconTooltip>}>
            <FieldRow fieldKey="text" fieldId={textId} label={t.labels.text} changed={textChanged} was={original.text || t.empty}
                error={textBad ? errorFor('text') : undefined} resetLabel={t.reset(t.text)}
                onReset={() => onChange({ ...values, text: original.text })}>
                <textarea id={textId} data-uier-proposal-input="text" aria-label={t.text} value={text} maxLength={changeProposalTextMaxLength}
                    rows={Math.min(4, Math.max(1, Math.ceil(text.length / 32) + (text.match(/\n/g)?.length ?? 0)))}
                    aria-invalid={textBad || undefined} aria-describedby={describedBy(textId, textChanged, textBad)}
                    className={cx('block max-h-32 min-h-8 w-full resize-none rounded-md border bg-background px-2 py-1.5 text-base text-foreground [field-sizing:content] sm:text-xs pointer-coarse:min-h-11',
                        textBad ? 'border-[hsl(var(--destructive))]' : 'border-input', inputFocusRingClassName)}
                    onChange={event => onChange({ ...values, text: event.target.value })} />
            </FieldRow>
            {wording && suggestions && original.text && <RewriteSuggestions text={original.text} state={suggestions}
                onPick={suggestion => onChange({ ...values, text: suggestion })} />}
        </FieldGroup>}
        {textStyle.some(property => original.styles[property] !== undefined) && <FieldGroup title={t.groups.text}>
            {textStyle.map(styleField)}
        </FieldGroup>}
        {showBox && boxStyle.some(property => original.styles[property] !== undefined) && <FieldGroup title={t.groups.box}
            action={hasPadding && <IconTooltip label={eachSide ? t.linkSides : t.eachSide}>
                <IconButton variant={eachSide ? 'soft' : 'plain'} size="xs" type="button" aria-label={t.eachSide} aria-pressed={eachSide}
                    data-uier-proposal-padding-sides="" className="size-7 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                    onClick={toggleSides}>
                    {eachSide ? <LinkOff size={14} aria-hidden="true" /> : <Link size={14} aria-hidden="true" />}
                </IconButton>
            </IconTooltip>}>
            {styleField('background-color')}
            {hasPadding && (eachSide ? axes.flatMap(([, first, second]) => [first, second]).map(styleField) : axes.map(axisField))}
            {styleField('border-radius')}
        </FieldGroup>}
        {!(element?.box ?? true) && !boxEdited && <Button type="button" size="xs" variant="plain" aria-expanded={more}
            data-uier-proposal-more="" className="justify-self-start text-muted-foreground pointer-coarse:min-h-11"
            endDecorator={more ? <Up size={14} aria-hidden="true" /> : <Down size={14} aria-hidden="true" />}
            onClick={() => setMore(!more)}>
            {more ? t.fewerProperties : t.moreProperties}
        </Button>}
    </section>;
}

function FieldGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
    const headingId = useId();
    return <div role="group" aria-labelledby={headingId} className="grid gap-2">
        <div className="flex min-h-7 items-center justify-between gap-2">
            <h4 id={headingId} className="m-0 text-xs font-medium text-muted-foreground">{title}</h4>
            {action}
        </div>
        {children}
    </div>;
}

/** One field: its name (with a dot once changed), the control, Reset, and under it its original and any problem */
function FieldRow({ fieldKey, fieldId, label, changed, was, error, resetLabel, onReset, children }: {
    fieldKey: FieldKey;
    fieldId: string;
    label: string;
    changed: boolean;
    was: string;
    error?: string;
    resetLabel: string;
    onReset: () => void;
    children: ReactNode;
}) {
    const t = useMessages().proposal;
    return <div data-uier-proposal-field={fieldKey} data-changed={changed || undefined}
        className="grid grid-cols-[5.5rem_minmax(0,1fr)_1.75rem] items-start gap-x-2 gap-y-1 pointer-coarse:grid-cols-[5.5rem_minmax(0,1fr)_2.75rem]">
        {/* The name and Reset sit by the control's first line, also beside an open colour picker */}
        <label htmlFor={fieldId} className="flex min-h-8 min-w-0 items-center gap-1.5 text-xs text-secondary-foreground pointer-coarse:min-h-11">
            <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', changed ? 'bg-foreground' : 'bg-transparent')} />
            <span className="truncate">{label}</span>
        </label>
        <div className="min-w-0">{children}</div>
        {changed
            ? <IconTooltip label={resetLabel}>
                <IconButton variant="plain" size="xs" type="button" aria-label={resetLabel} data-uier-proposal-reset={fieldKey}
                    className="mt-0.5 size-7 rounded-md text-muted-foreground hover:text-foreground pointer-coarse:mt-0 pointer-coarse:size-11" onClick={onReset}>
                    <Reset size={14} aria-hidden="true" />
                </IconButton>
            </IconTooltip>
            : <span />}
        {changed && <p id={`${fieldId}-was`} className="col-start-2 col-end-4 m-0 min-w-0 truncate text-[11px] text-muted-foreground">{t.was(was)}</p>}
        {error && <p id={`${fieldId}-error`} className={cx('col-start-2 col-end-4 m-0 text-xs', destructiveTextClassName)}>{error}</p>}
    </div>;
}
