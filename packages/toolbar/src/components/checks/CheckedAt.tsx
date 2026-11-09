/** When a panel's check ran, as the reviewer's clock shows it ("Checked at 14:32"), and with what */
export function CheckedAt({ time, by }: { time: number; by?: string }) {
    const date = new Date(time);
    return <>Checked at <time dateTime={date.toISOString()}>{date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>{by ? ` with ${by}` : ''}.</>;
}
