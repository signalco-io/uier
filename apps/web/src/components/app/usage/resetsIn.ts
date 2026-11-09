/** "in 17 minutes", "in about an hour", "in about 5 hours": when a limit's counts start again */
export function resetsIn(seconds: number) {
    if (seconds < 60)
        return 'in less than a minute';
    if (seconds < 3600) {
        const minutes = Math.ceil(seconds / 60);
        return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
    }
    const hours = Math.round(seconds / 3600);
    return hours <= 1 ? 'in about an hour' : `in about ${hours} hours`;
}
