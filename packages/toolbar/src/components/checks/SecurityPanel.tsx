import { useEffect, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { useMessages } from '../../i18n';
import type { CheckState } from '../../checks/types';
import { ChecksPanel } from './ChecksPanel';
import { CheckFilterContext, ChecksSummary, checkStates } from './ChecksParts';
import { ChecksTabs } from './ChecksTabs';
import { GuestNameField } from './GuestName';
import { defineSection, ReportSection, usePageLayerVisible, usePanelSectionChecks, useSection } from './sections/sections';

export const consentSnapshot = defineSection({
    id: 'consent-snapshot', panel: 'consent', when: 'panel',
    run: (checks, context) => checks.consent.checkConsent(context)
});
export const consentObservation = defineSection({
    id: 'consent-observation', panel: 'consent', when: 'manual',
    run: (checks, context) => checks.consent.observeConsent(context)
});

export const securitySnapshot = defineSection({
    id: 'security-snapshot', panel: 'consent', when: 'panel',
    run: (checks, context) => checks.security.checkSecurity(context)
});
export const securityHeaders = defineSection({
    id: 'security-headers', panel: 'consent', when: 'manual',
    run: (checks, context) => checks.security.checkSecurityHeaders(context)
});

/** Page evidence on open. Only explicit controls request headers or start a consent observation. */
export function SecurityPanel({ onCheck, onClose }: { onCheck: () => void; onClose: () => void }) {
    const t = useMessages().consentPanel;
    const snapshot = useSection(consentSnapshot);
    const observation = useSection(consentObservation);
    const security = useSection(securitySnapshot);
    const headers = useSection(securityHeaders);
    const visible = usePageLayerVisible();
    const cancel = observation.cancel;
    useEffect(() => { if (!visible) cancel(); return cancel; }, [visible, cancel]);
    const cancelHeaders = headers.cancel;
    const cancelSecurity = security.cancel;
    useEffect(() => {
        if (!visible) { cancelHeaders(); cancelSecurity(); }
        return () => { cancelHeaders(); cancelSecurity(); };
    }, [visible, cancelHeaders, cancelSecurity]);
    const checks = usePanelSectionChecks('consent');
    const [selected, setSelected] = useState<CheckState>();
    const count = (state: CheckState) => checks.filter(check => check.state === state).length;
    const filter = selected && count(selected) ? selected : undefined;
    return <ChecksPanel id="consent" title={t.title} checking={snapshot.status === 'checking' || observation.status === 'checking' || security.status === 'checking' || headers.status === 'checking'} onCheckAgain={onCheck} onClose={onClose}>
        <ChecksSummary tiles={[
            { key: 'pass', label: t.passed, count: count('pass'), ...checkStates.pass },
            { key: 'warn', label: t.toReview, count: count('warn'), ...checkStates.warn },
            { key: 'none', label: t.notes, count: count('none'), ...checkStates.none }
        ]} selected={filter} onSelect={key => setSelected(key as CheckState | undefined)} />
        <GuestNameField panel="consent" />
        <CheckFilterContext value={filter}>
            <ChecksTabs panel="consent" label={t.title} filtered={!!filter} tabs={[
                { id: 'snapshot', label: t.snapshot, attention: snapshot.report?.checks.filter(check => check.state === 'warn').length ?? 0,
                    content: <><p className="m-0 text-xs text-muted-foreground" data-uier-consent-limits="">{t.limits}</p><ReportSection id={consentSnapshot.id} title={t.snapshot} section={snapshot} /></> },
                { id: 'security', label: t.security, attention: security.report?.checks.filter(check => check.state === 'warn').length ?? 0,
                    content: <><p className="m-0 text-xs text-muted-foreground" data-uier-security-limits="">{t.securityLimits}</p>
                        <ReportSection id={securitySnapshot.id} title={t.security} section={security} /></> },
                { id: 'headers', label: t.headers, attention: headers.report?.checks.filter(check => check.state === 'warn').length ?? 0,
                    content: <><p className="m-0 text-xs text-muted-foreground">{t.headerScope}</p>
                        <Button variant="outlined" size="sm" data-uier-security-headers="" disabled={!visible || headers.status === 'checking'} onClick={headers.run}>
                            {headers.status === 'checking' ? t.checkingHeaders : t.checkHeaders}
                        </Button>
                        <ReportSection id={securityHeaders.id} title={t.headers} section={headers} /></> },
                { id: 'before-consent', label: t.before, attention: observation.report?.checks.filter(check => check.state === 'warn').length ?? 0,
                    content: <>
                        <p className="m-0 text-xs text-muted-foreground">{t.instructions}</p>
                        <Button variant="outlined" size="sm" data-uier-consent-observe="" disabled={!visible || snapshot.status === 'checking' || observation.status === 'checking'}
                            onClick={observation.run}>{observation.status === 'checking' ? t.observing : t.observe}</Button>
                        <ReportSection id={consentObservation.id} title={t.before} section={observation} />
                    </> }
            ]} />
        </CheckFilterContext>
    </ChecksPanel>;
}
