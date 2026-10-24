'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '@signalco/ui-primitives/cx';

type TokenSwatchProps = {
    /** CSS custom property holding an HSL triplet, e.g. `--foreground`. */
    token: string;
    name: string;
    role: string;
    bordered?: boolean;
};

function toHex(color: string) {
    const parts = color.match(/[\d.]+/g);
    if (!parts || parts.length < 3) {
        return color;
    }
    const [r, g, b, a] = parts.map(Number);
    const hex = '#' + [r, g, b].map(v => Math.round(v ?? 0).toString(16).padStart(2, '0')).join('').toUpperCase();
    return a !== undefined && a < 1 ? `${hex} · ${Math.round(a * 100)}%` : hex;
}

/** A colour swatch that reads its value from the live stylesheet, so it shows what actually ships. */
export function TokenSwatch({ token, name, role, bordered }: TokenSwatchProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [value, setValue] = useState<string>();

    useEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        const update = () => setValue(toHex(getComputedStyle(element).backgroundColor));
        update();
        // next-themes switches the `dark` class on <html>; re-read when it does.
        const observer = new MutationObserver(update);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    return (
        <div className="flex flex-col gap-2">
            <div
                ref={ref}
                className={cx('h-16 rounded-[10px]', bordered && 'border')}
                style={{ backgroundColor: `hsl(var(${token}))` }} />
            <span className="text-xs font-medium">{name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{value ?? token}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">{role}</span>
        </div>
    );
}
