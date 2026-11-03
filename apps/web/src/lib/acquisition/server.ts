import { getAppStore } from '../app/store';
import { userPk, type DbUser } from '../app/model';
import { stages, type AcquisitionStage, type AcquisitionState, type Attribution, type AcquisitionEvent } from './types';

/** Best effort product measurements never make a completed business operation fail. */
export async function markAcquisitionMilestone(userId: string, stage: AcquisitionStage) {
    try {
        const store = getAppStore();
        for (let attempt = 0; attempt < 3; attempt++) {
            const stored = await store.get<DbUser>(userPk(userId), userId);
            const state = stored?.doc.acquisition;
            if (!stored || !state || state.milestones[stage]) return;
            const acquisition = { ...state, milestones: { ...state.milestones, [stage]: new Date().toISOString() } };
            const result = await store.replace({ ...stored.doc, acquisition }, stored.etag);
            if (result !== 'conflict') return;
        }
    } catch { console.error('[acquisition] Milestone recording failed'); }
}

/** Called only for the authenticated user. Claim each milestone at most once across tabs/devices. */
export async function claimAcquisitionEvents(userId: string, attribution: Attribution) {
    const store = getAppStore();
    for (let attempt = 0; attempt < 3; attempt++) {
        const stored = await store.get<DbUser>(userPk(userId), userId);
        const state = stored?.doc.acquisition;
        if (!stored || !state) return { enabled: false, events: [] as AcquisitionEvent[] };
        const freshAttribution = Date.now() - Date.parse(stored.doc.createdAt) < 24 * 60 * 60 * 1000;
        const acquisition: AcquisitionState = {
            ...state,
            attribution: state.attribution ?? (freshAttribution ? attribution : { channel: 'unknown', source: 'unknown' }),
            milestones: { ...state.milestones, sign_in: state.milestones.sign_in ?? new Date().toISOString() }
        };
        const pending = stages.filter(stage => acquisition.milestones[stage] && !acquisition.delivered.includes(stage));
        if (!pending.length) return { enabled: acquisition.delivered.length < stages.length, events: [] as AcquisitionEvent[] };
        acquisition.delivered = [...acquisition.delivered, ...pending];
        const result = await store.replace({ ...stored.doc, acquisition }, stored.etag);
        if (result === 'conflict') continue;
        if (result === 'not_found') return { enabled: false, events: [] as AcquisitionEvent[] };
        return {
            enabled: acquisition.delivered.length < stages.length,
            events: pending.map(stage => ({ ...acquisition.attribution!, stage }))
        };
    }
    throw new Error('Acquisition state changed concurrently');
}
