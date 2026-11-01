/**
 * A popover that opens on hover as well as on click (the project's access info, a comment's
 * device). Spread on `PopoverTrigger`. Base UI moves focus in only when a click or the keyboard
 * opens it; opened by hovering it leaves focus alone and closes when the pointer leaves, and a
 * click while hover-opened keeps it open.
 */
export const hoverPopoverTrigger = { openOnHover: true, delay: 0, closeDelay: 150 } as const;
