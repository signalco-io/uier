import type { CSSProperties, InputHTMLAttributes } from 'react';
import { cx } from '@signalco/ui-primitives/cx';

/**
 * A slider for the suggestion editor: a native range input, so it has its name, its value text and the keyboard
 * (arrows, Page Up/Down, Home/End) and touch from the browser. The kit's `Slider` leaves its thumb unnamed.
 * `track` paints the track (a colour picker's hue or opacity); by default it fills up to the value in ink.
 */
const base = cx(
    'block w-full min-w-0 cursor-pointer appearance-none rounded-full bg-transparent',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:cursor-not-allowed disabled:opacity-50',
    '[&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:[background:var(--uier-range-track)]',
    '[&::-moz-range-track]:rounded-full [&::-moz-range-track]:[background:var(--uier-range-track)]',
    '[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2',
    '[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2'
);
// The thumb sits on the middle of the track: WebKit draws it from the track's top
const thin = cx('h-5 pointer-coarse:h-11',
    '[&::-webkit-slider-runnable-track]:h-1.5 [&::-moz-range-track]:h-1.5 [&::-webkit-slider-thumb]:-mt-[5px]',
    '[&::-webkit-slider-thumb]:border-foreground [&::-webkit-slider-thumb]:bg-background',
    '[&::-moz-range-thumb]:border-foreground [&::-moz-range-thumb]:bg-background');
const thick = cx('h-5 pointer-coarse:h-11',
    '[&::-webkit-slider-runnable-track]:h-3 [&::-moz-range-track]:h-3 [&::-webkit-slider-thumb]:-mt-0.5',
    '[&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgb(0_0_0/0.45)]',
    '[&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:shadow-[0_0_0_1px_rgb(0_0_0/0.45)]');

type RangeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> & {
    value: number;
    min: number;
    max: number;
    step: number;
    onValueChange: (value: number) => void;
    /** The track's background, instead of the ink fill */
    track?: string;
};

export function RangeInput({ value, min, max, step, onValueChange, track, className, style, ...rest }: RangeInputProps) {
    const shown = Math.min(Math.max(value, min), max);
    const fill = max > min ? (shown - min) / (max - min) * 100 : 0;
    const background = track ?? `linear-gradient(to right, hsl(var(--foreground)) ${fill}%, hsl(var(--border)) ${fill}%)`;
    return (
        <input
            {...rest}
            type="range"
            min={min}
            max={max}
            step={step}
            value={shown}
            onChange={event => onValueChange(Number(event.currentTarget.value))}
            className={cx(base, track ? thick : thin, className)}
            style={{ ...style, '--uier-range-track': background } as CSSProperties} />
    );
}
