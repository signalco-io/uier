import type { ImpactValue } from 'axe-core';

// What both bundles say about axe-core's rules: the review bundle's panel, and the audit asset's
// report of a run (`lazy/accessibilityReport.ts`). Pure: no imports at run time.

export type Impact = Exclude<ImpactValue, null>;
export const impacts: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'];

/**
 * What a rule tests, from axe-core's tags: its WCAG success criteria (`wcag143` is 1.4.3) with the
 * level (`wcag2aa`, `wcag21aa`, `wcag22aa`), or "Best practice" for a rule outside WCAG
 */
export function ruleStandard(tags: readonly string[]): string | undefined {
    const criteria = tags.flatMap(tag => {
        const digits = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
        return digits ? [`${digits[1]}.${digits[2]}.${digits[3]}`] : [];
    });
    const level = tags.map(tag => /^wcag2[12]?(a{1,3})$/.exec(tag)?.[1]).find(Boolean)?.toUpperCase();
    if (criteria.length || level) return `WCAG${criteria.length ? ` ${criteria.join(', ')}` : ''}${level ? criteria.length ? ` (${level})` : ` ${level}` : ''}`;
    return tags.includes('best-practice') ? 'Best practice' : undefined;
}
