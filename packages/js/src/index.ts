/** Whether `value` is an absolute `http(s)://` address (the kit's `Link` opens those in a new tab) */
export const isAbsoluteUrl = (value: string | null): boolean => {
    if (value == null) return false;
    const match = value.match(/^https?:\/\//);
    return match != null && match.length > 0;
};
