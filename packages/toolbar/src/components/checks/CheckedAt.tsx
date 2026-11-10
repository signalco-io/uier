import { useMessages } from '../../i18n';
/** When a panel's check ran, as the reviewer's clock shows it ("Checked at 14:32"), and with what */
export function CheckedAt({ time, by }: { time: number; by?: string }) {
    const t = useMessages();
    const date = new Date(time);
    // The time in the reviewer's own format, the words in the toolbar's language
    return <>{t.checks.checkedAtBefore}<time dateTime={date.toISOString()}>{date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>{t.checks.checkedAtAfter}{by ? t.checks.checkedWith(by) : ''}.</>;
}
