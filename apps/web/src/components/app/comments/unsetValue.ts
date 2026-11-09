/**
 * One "not set" look for every thread detail still at its default or unset (Unassigned, the default
 * Normal priority, no pull request linked): muted text with its icon in the same colour (`currentColor`),
 * brightening to ink on hover when it is a control. Set values keep the ink colour, so set and unset are
 * told apart the same way in every row. `data-unset` marks them.
 */
export const unsetValueClass = 'text-muted-foreground hover:text-foreground';
