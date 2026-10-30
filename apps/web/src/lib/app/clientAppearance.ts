// What a client's tile can look like. Shared by the client edit dialog and server-side validation;
// `ClientMark` draws them.

/** Lucide icons a client can show instead of its first letter */
export const clientIcons = [
    'briefcase', 'building', 'store', 'shopping-bag', 'globe', 'rocket',
    'heart', 'leaf', 'graduation-cap', 'landmark', 'utensils', 'camera'
] as const;
export type ClientIcon = typeof clientIcons[number];

/** Brand token colours (`@uier/brand/tokens.css`) for a client's tile; without one the tile is ink on paper */
export const clientColors = ['blue', 'green', 'amber', 'red'] as const;
export type ClientColor = typeof clientColors[number];
