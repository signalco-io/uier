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
//
// The project's code (`project-ref`) is claimed before the document, as for every project, and is permanent from
// the start: a project that exists must never lose its code. A request that stops between the claim and the
// document, and is never sent again, leaves that claim (a random code and the workspace id) behind for good, as
// the app's own creation does. Giving such a claim an expiry was tried and is unsafe: making it permanent is a
// second write in another partition, and a project whose creation stopped before that write lost its code.

/**
 * How long a request is the same request: for this long a retry finds its receipt and gets the one project, or
 * the answer that it was removed. The privacy policy states this period; change both together.
 */
export const PROJECT_RECEIPT_SECONDS = 30 * 24 * 60 * 60;
/** How much longer than its receipt a marker stays: no retry can come after it */
const PROJECT_RECEIPT_MARGIN_SECONDS = 24 * 60 * 60;
/** No stored document has this version: a replace that names it changes nothing and says whether the document is there */
const NO_VERSION = '"00000000-0000-0000-0000-000000000000"';

export type ProjectReceipt = AppDoc & {
    type: 'project-receipt';
    userId: string;
    workspaceId: string;
    /** The code reserved for this attempt's project: random, and claimed only when the project is created */
    projectId: string;
    createdAt: string;
};
/** One unit of the budget in one window */
type ReceiptSlot = AppDoc & { type: 'project-receipt-slot'; window: string; slot: number };
export type ProjectCreated = AppDoc & { type: 'project-created'; projectId: string; createdAt: string };

/** Seconds until a day after the receipt expires, for the marker that must outlast it, whenever it is written */
function markerSeconds(receipt: Pick<ProjectReceipt, 'createdAt'>) {
    const end = Date.parse(receipt.createdAt) / 1000 + PROJECT_RECEIPT_SECONDS + PROJECT_RECEIPT_MARGIN_SECONDS;
    return Math.max(60, Math.ceil(end - Date.now() / 1000));
}

const receiptPk = (userId: string) => `project-receipt:${userId}`;

/** The marker of a receipt's project, for the transaction that creates the project document */
export function projectCreatedMarker(receipt: Pick<ProjectReceipt, 'workspaceId' | 'projectId' | 'createdAt'>): ProjectCreated {
    return { type: 'project-created', id: `created_${receipt.projectId}`, pk: workspacePk(receipt.workspaceId), projectId: receipt.projectId,
        createdAt: new Date(Date.now()).toISOString(), ttl: markerSeconds(receipt) };
}

/**
 * The receipt of one creation attempt: the person, the workspace, the attempt and the validated input (`setup`,
 * anything that serializes the same for the same input). The first request writes it and takes one unit of `limit`
 * (the person's budget in the current window) in the same transaction; every other request with the same four gets
 * that receipt and takes nothing, at once or weeks later. `projectId` is used only by the request that writes it.
 *
 * Reads can be behind (another instance's write is not in this one's session yet), so no answer rests on a read
 * that found nothing. Two writes decide. The transaction reserves, where the window seems to have a free unit.
 * And before a request is refused, or after its transaction failed, a replace that names a version no document
 * has asks the store whether the receipt exists: it changes nothing, and it is answered where writes are, so it
 * knows of every receipt committed before it, in this window or an earlier one. A request is refused as rate
 * limited only when that says there is none.
 */
export async function reserveProjectReceipt(
    { userId, workspaceId, attempt, setup, projectId, limit }: { userId: string; workspaceId: string; attempt: string; setup: unknown; projectId: () => string; limit: Limit },
    store: AppStore = getAppStore()
): Promise<ProjectReceipt> {
    const pk = receiptPk(userId);
    const id = `receipt_${sha256Hex(JSON.stringify([attempt, workspaceId, setup]))}`;
    const read = async () => {
        const saved = (await store.get<ProjectReceipt>(pk, id))?.doc;
        return saved?.type === 'project-receipt' && saved.workspaceId === workspaceId ? saved : undefined;
    };
    // Each round another request took the slot this one tried: a full budget ends the rounds first
    for (let round = 0; round <= limit.limit; round++) {
        const saved = await read();
        if (saved)
            return saved;
        const { id: window, resetsInSeconds } = limitWindow(limit);
        const taken = new Set((await store.query<ReceiptSlot>({ type: 'project-receipt-slot', pk, where: { window } })).map(slot => slot.slot));
        let free = 0;
        while (taken.has(free)) free++;
        const receipt: ProjectReceipt = { type: 'project-receipt', id, pk, userId, workspaceId, projectId: projectId(),
            createdAt: new Date(Date.now()).toISOString(), ttl: PROJECT_RECEIPT_SECONDS };
        // Kept a little longer than the window, as the counters of other limits are
        const slot: ReceiptSlot = { type: 'project-receipt-slot', id: `slot_${window}_${free}`, pk, window, slot: free, ttl: limit.windowSeconds + 300 };
        if (free < limit.limit && await store.createAll([receipt, slot]))
            return receipt;
        // The window is full or the transaction failed. Either way: is this attempt's receipt there?
        if (await store.replace(receipt, NO_VERSION) !== 'not_found') {
            // It is. The answer came from where it was written, so this session reads it now, at the latest after a moment
            for (let wait = 0; wait < 6; wait++) {
                const committed = await read();
                if (committed)
                    return committed;
                await new Promise(resolve => setTimeout(resolve, 20 * (wait + 1)));
            }
            throw new ApiError(409, 'conflict', 'This request could not be saved. Try again.', 1);
        }
        if (free >= limit.limit)
            throw apiErrors.rateLimited(limit.message, resetsInSeconds, limit.reason);
        // Another attempt took the slot: read again, after a moment for its write to arrive
        await new Promise(resolve => setTimeout(resolve, Math.min(10 * (round + 1), 100)));
    }
    throw new ApiError(409, 'conflict', 'This request could not be saved. Try again.', 1);
}
