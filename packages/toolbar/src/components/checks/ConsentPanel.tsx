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

/** No background storage reads: a reviewer opens the tool, and explicitly starts the observation. */
export function ConsentPanel({ onCheck, onClose }: { onCheck: () => void; onClose: () => void }) {
    const t = useMessages().consentPanel;
    const snapshot = useSection(consentSnapshot);
    const observation = useSection(consentObservation);
    const visible = usePageLayerVisible();
    const cancel = observation.cancel;
    useEffect(() => { if (!visible) cancel(); return cancel; }, [visible, cancel]);
    const checks = usePanelSectionChecks('consent');
    const [selected, setSelected] = useState<CheckState>();
    const count = (state: CheckState) => checks.filter(check => check.state === state).length;
    const filter = selected && count(selected) ? selected : undefined;
    return <ChecksPanel id="consent" title={t.title} checking={snapshot.status === 'checking' || observation.status === 'checking'} onCheckAgain={onCheck} onClose={onClose}>
        <ChecksSummary tiles={[
            { key: 'warn', label: t.toReview, count: count('warn'), ...checkStates.warn },
            { key: 'none', label: t.notes, count: count('none'), ...checkStates.none }
        ]} selected={filter} onSelect={key => setSelected(key as CheckState | undefined)} />
        <p className="m-0 text-xs text-muted-foreground" data-uier-consent-limits="">{t.limits}</p>
        <GuestNameField panel="consent" />
        <CheckFilterContext value={filter}>
            <ChecksTabs panel="consent" label={t.title} filtered={!!filter} tabs={[
                { id: 'snapshot', label: t.snapshot, attention: snapshot.report?.checks.filter(check => check.state === 'warn').length ?? 0,
                    content: <ReportSection id={consentSnapshot.id} title={t.snapshot} section={snapshot} /> },
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
