import type { DbProject } from '../app/model';
import { memberActor } from '../review/actor';
import type { ProofActor } from './model';
import { proofNotFound } from './store';

/** Pre-authorized source workflows resolve a live member without minting any browser credential. */
export async function requireProofMemberById(project: DbProject, userId: string): Promise<Extract<ProofActor, { kind: 'member' }>> {
    const actor = await memberActor(project, userId);
    if (actor?.kind !== 'member') throw proofNotFound();
    return { ...actor, scope: { kind: 'project' }, view: true, comment: project.access !== 'disabled', downloadOriginal: true, manage: true };
}
