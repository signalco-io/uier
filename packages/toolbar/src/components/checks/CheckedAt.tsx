/** When a panel's check ran, as the reviewer's clock shows it ("Checked at 14:32") */
export function CheckedAt({ time }: { time: number }) {
    const date = new Date(time);
    return <time dateTime={date.toISOString()}>Checked at {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.</time>;
}
