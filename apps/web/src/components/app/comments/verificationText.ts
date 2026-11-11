import type { VerificationDetails } from '@uier/toolbar/verification';
import type { AppLanguage } from '@/src/lib/i18n/languages';
import type { AppTranslator } from '@/src/lib/i18n/types';

/** Verification facts stay unchanged; only the surrounding wording and date presentation are localized. */
export function verificationText(v: VerificationDetails, t: AppTranslator, language: AppLanguage) {
    const time = (value: string) => {
        const date = new Date(value);
        return Number.isFinite(date.getTime())
            ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(date) + ' UTC'
            : value;
    };
    const decision = v.decision;
    const attribution = decision ? t('{actor} at {time}{override}', {
        actor: decision.actor,
        time: time(decision.at),
        override: decision.override ? t(' (admin override for {reviewer})', { reviewer: v.reviewer }) : ''
    }) : '';
    if (v.outcome === 'confirmed' && decision?.kind === 'confirm') return t('Fix confirmed by {attribution}.', { attribution });
    const labels: Record<VerificationDetails['outcome'], string> = {
        pending: 'Ready to verify', 'needs-work': 'Still needs work', canceled: 'Request canceled',
        unconfirmed: 'Done without reviewer confirmation', reopened: 'Reopened', unavailable: 'Reviewer unavailable', confirmed: 'Done'
    };
    const requested = t('Requested by {requester} for {reviewer} at {time}.', { requester: v.requester, reviewer: v.reviewer, time: time(v.requestedAt) });
    const historical = decision ? decision.kind === 'confirm'
        ? t('Previous confirmation by {attribution}; historical only.', { attribution })
        : decision.kind === 'reject' ? t('Needs work decision by {attribution}.', { attribution }) : t('Cancellation by {attribution}.', { attribution }) : '';
    return `${t(labels[v.outcome])}. ${requested}${historical ? ` ${historical}` : ''}`;
}
