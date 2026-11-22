import { getToolbarHost } from './mount';
import { formatColor, parseColor } from './styleValues';

const maxElements = 600;

/**
 * The colours the reviewed page uses most, for the colour picker's swatches: the text and fill colours of its first
 * elements, most used first, in hex. Read when the picker opens, never stored. The toolbar's own elements don't count.
 */
export function pageColors(limit = 10): string[] {
    const counts = new Map<string, number>();
    const host = getToolbarHost();
    const elements = document.body?.getElementsByTagName('*') ?? [];
    for (let index = 0; index < elements.length && index < maxElements; index++) {
        const element = elements[index]!;
        if (element === host || host?.contains(element)) continue;
        const style = getComputedStyle(element);
        for (const value of [style.color, style.backgroundColor]) {
            const color = parseColor(value);
            if (!color || color.a < 0.05) continue;
            const hex = formatColor({ ...color, a: 1 }, 'hex');
            counts.set(hex, (counts.get(hex) ?? 0) + 1);
        }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([hex]) => hex);
}
