import { ApiError, apiErrors } from '../comments/http';
import { limitWindow, type Limit } from '../comments/rateLimits';
import { workspacePk, type AppDoc } from './model';
import { getAppStore, type AppStore } from './store';
import { sha256Hex } from './tokens';

// Repeatable project creation (`createProject` with a receipt). A caller that retries (the browser extension's
// worker) sends a random attempt with its request. Two records make every copy of that request one project:
//
// - The receipt, in the person's partition: the attempt reserved one unit of a budget and one project code. It is
//   written with its budget slot in one transaction, before anything of the project exists, so requests that
//   arrive together or again find the same receipt, are charged once and work on the same code.
// - The created marker, in the workspace's partition: written in one transaction with the project document. A
//   project of a receipt can be created only where no marker is, so once, ever. A receipt whose project is not
//   there is unfinished without the marker and removed (deleted or transferred) with it; only the first is created.
//
// Both hold identifiers and hashes only and expire by themselves. Deletion and transfer leave the marker in place:
// removing it would let a replay that started before them create the document again.

/** How long a retry finds its receipt; the marker outlives every receipt that names its project */
export const PROJECT_RECEIPT_SECONDS = 29 * 24 * 60 * 60;
export const PROJECT_CREATED_SECONDS = 30 * 24 * 60 * 60;

export type ProjectReceipt = AppDoc & {
    type: 'project-receipt';
    userId: string;
    workspaceId: string;
    /** The code reserved for this attempt's project: random, and claimed only when the project is created */
    projectId: string;
    createdAt: string;
};
type ReceiptSlot = AppDoc & { type: 'project-receipt-slot'; window: string; slot: number };
export type ProjectCreated = AppDoc & { type: 'project-created'; projectId: string; createdAt: string };

const receiptPk = (userId: string) => `project-receipt:${userId}`;

/** The marker of a receipt's project, for the transaction that creates the project document */
export function projectCreatedMarker(receipt: Pick<ProjectReceipt, 'workspaceId' | 'projectId'>): ProjectCreated {
    return { type: 'project-created', id: `created_${receipt.projectId}`, pk: workspacePk(receipt.workspaceId), projectId: receipt.projectId,
        createdAt: new Date().toISOString(), ttl: PROJECT_CREATED_SECONDS };
}

/**
 * The receipt of one creation attempt: the person, the workspace, the attempt and the validated input (`setup`,
 * anything that serializes the same for the same input). The first request writes it and takes one unit of `limit`
 * (the person's budget in the current window) in the same transaction; every other request with the same four gets
 * that receipt and takes nothing, at once or weeks later. Without a free unit nothing is written and the request
 * is refused as rate limited. `projectId` is used only by the request that writes the receipt.
 */
export async function reserveProjectReceipt(
    { userId, workspaceId, attempt, setup, projectId, limit }: { userId: string; workspaceId: string; attempt: string; setup: unknown; projectId: () => string; limit: Limit },
    store: AppStore = getAppStore()
): Promise<ProjectReceipt> {
    const pk = receiptPk(userId);
    const id = `receipt_${sha256Hex(JSON.stringify([attempt, workspaceId, setup]))}`;
    // Each round another request took the slot this one tried: a full budget ends the rounds first
    for (let round = 0; round <= limit.limit; round++) {
        const saved = (await store.get<ProjectReceipt>(pk, id))?.doc;
        if (saved?.type === 'project-receipt' && saved.workspaceId === workspaceId)
            return saved;
        const { id: window, resetsInSeconds } = limitWindow(limit);
        const taken = new Set((await store.query<ReceiptSlot>({ type: 'project-receipt-slot', pk, where: { window } })).map(slot => slot.slot));
        let free = 0;
        while (taken.has(free)) free++;
        if (free >= limit.limit)
            throw apiErrors.rateLimited(limit.message, resetsInSeconds, limit.reason);
        const receipt: ProjectReceipt = { type: 'project-receipt', id, pk, userId, workspaceId, projectId: projectId(),
            createdAt: new Date().toISOString(), ttl: PROJECT_RECEIPT_SECONDS };
        // Kept a little longer than the window, as the counters of other limits are
        const slot: ReceiptSlot = { type: 'project-receipt-slot', id: `slot_${window}_${free}`, pk, window, slot: free, ttl: limit.windowSeconds + 300 };
        if (await store.createAll([receipt, slot]))
            return receipt;
    }
    throw new ApiError(409, 'conflict', 'This request could not be saved. Try again.', 1);
}
