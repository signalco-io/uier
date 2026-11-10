import { useMessages } from '../../i18n';
/** When a panel's check ran, as the reviewer's clock shows it ("Checked at 14:32."); not with what, since the checks change */
export function CheckedAt({ time }: { time: number }) {
    const t = useMessages();
    const date = new Date(time);
    // The time in the reviewer's own format, the words in the toolbar's language
    return <>{t.checks.checkedAtBefore}<time dateTime={date.toISOString()}>{date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>{t.checks.checkedAtAfter}.</>;
}
