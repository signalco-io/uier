/** Icon content widths in CSS pixels, inside each mark's border and padding. */
export const projectIconSizes = {
    inline: 10,
    sidebar: 14,
    memberProjects: 18,
    card: 26,
    header: 34
} as const;

export type ProjectIconSize = typeof projectIconSizes[keyof typeof projectIconSizes];

const supportedSizes = new Set(Object.values(projectIconSizes).flatMap(size => [String(size), String(size * 2)]));

/** Accept only the sizes used by the marks, including their 2× variants. */
export function parseProjectIconSize(value: string) {
    return supportedSizes.has(value) ? Number(value) : undefined;
}
