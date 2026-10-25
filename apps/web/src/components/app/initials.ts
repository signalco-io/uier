/** The letter of a person's avatar */
export function initials(name: string) {
    return (name.trim()[0] ?? '?').toUpperCase();
}
