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
// A third record is the project's code claim (`project-ref`), which a project needs before its document. For a
// receipt it is claimed with an expiry and made permanent once the project exists (`ensureProjectCode`), so a
// request that stopped in between leaves nothing behind for good.
//
// All hold identifiers and hashes only and expire by themselves. Deletion and transfer leave the marker in place:
// removing it would let a replay that started before them create the document again.

/**
 * How long a request is the same request: for this long a retry finds its receipt and gets the one project, or
 * the answer that it was removed. The privacy policy states this period; change both together.
 */
export const PROJECT_RECEIPT_SECONDS = 30 * 24 * 60 * 60;
/** How much longer than its receipt a marker, or an unused code claim, stays: no retry can come after them */
const PROJECT_RECEIPT_MARGIN_SECONDS = 24 * 60 * 60;

export type ProjectReceipt = AppDoc & {
    type: 'project-receipt';
    userId: string;
    workspaceId: string;
    /** The code reserved for this attempt's project: random, and claimed only when the project is created */
    projectId: string;
    createdAt: string;
};
/** One unit of the budget, naming the receipt it was written with: a full window shows whether it holds this attempt */
type ReceiptSlot = AppDoc & { type: 'project-receipt-slot'; window: string; slot: number; receipt: string; workspaceId: string; projectId: string; createdAt: string };
export type ProjectCreated = AppDoc & { type: 'project-created'; projectId: string; createdAt: string };

/**
 * Seconds until a day after the receipt expires, for the records that must outlast it: the created marker and the
 * code claim of a project that does not exist yet. Counted from the receipt, whenever they are written.
 */
export function receiptRecordSeconds(receipt: Pick<ProjectReceipt, 'createdAt'>) {
    const end = Date.parse(receipt.createdAt) / 1000 + PROJECT_RECEIPT_SECONDS + PROJECT_RECEIPT_MARGIN_SECONDS;
    return Math.max(60, Math.ceil(end - Date.now() / 1000));
}

const receiptPk = (userId: string) => `project-receipt:${userId}`;

/** The marker of a receipt's project, for the transaction that creates the project document */
export function projectCreatedMarker(receipt: Pick<ProjectReceipt, 'workspaceId' | 'projectId' | 'createdAt'>): ProjectCreated {
    return { type: 'project-created', id: `created_${receipt.projectId}`, pk: workspacePk(receipt.workspaceId), projectId: receipt.projectId,
        createdAt: new Date(Date.now()).toISOString(), ttl: receiptRecordSeconds(receipt) };
}

/**
 * The receipt of one creation attempt: the person, the workspace, the attempt and the validated input (`setup`,
 * anything that serializes the same for the same input). The first request writes it and takes one unit of `limit`
 * (the person's budget in the current window) in the same transaction; every other request with the same four gets
 * that receipt and takes nothing, at once or weeks later. `projectId` is used only by the request that writes it.
 *
 * Only the transaction decides who reserves; the reads before it can be behind (another instance's write is not
 * in this one's session yet). So each round reads the window's slots first and the receipt after them, which this
 * session reads no older than the slots. A request is refused as rate limited only on a window that is full
 * without it: the slots name their receipts, so a window the original request filled a moment ago shows that
 * request, and a receipt of an earlier window is older than every slot read. A window that is not full goes to
 * the transaction, where an existing receipt fails the write and the next round finds it.
 */
export async function reserveProjectReceipt(
    { userId, workspaceId, attempt, setup, projectId, limit }: { userId: string; workspaceId: string; attempt: string; setup: unknown; projectId: () => string; limit: Limit },
    store: AppStore = getAppStore()
): Promise<ProjectReceipt> {
    const pk = receiptPk(userId);
    const id = `receipt_${sha256Hex(JSON.stringify([attempt, workspaceId, setup]))}`;
    // Each round another request took the slot this one tried: a full budget ends the rounds first
    for (let round = 0; round <= limit.limit; round++) {
        const { id: window, resetsInSeconds } = limitWindow(limit);
        const slots = await store.query<ReceiptSlot>({ type: 'project-receipt-slot', pk, where: { window } });
        const saved = (await store.get<ProjectReceipt>(pk, id))?.doc;
        if (saved?.type === 'project-receipt' && saved.workspaceId === workspaceId)
            return saved;
        // Written with this attempt's receipt in one transaction: the receipt is there, whatever its own read said
        const own = slots.find(slot => slot.receipt === id && slot.workspaceId === workspaceId);
        if (own)
            return { type: 'project-receipt', id, pk, userId, workspaceId, projectId: own.projectId, createdAt: own.createdAt, ttl: PROJECT_RECEIPT_SECONDS };
        const taken = new Set(slots.map(slot => slot.slot));
        let free = 0;
        while (taken.has(free)) free++;
        if (free >= limit.limit)
            throw apiErrors.rateLimited(limit.message, resetsInSeconds, limit.reason);
        const receipt: ProjectReceipt = { type: 'project-receipt', id, pk, userId, workspaceId, projectId: projectId(),
            createdAt: new Date(Date.now()).toISOString(), ttl: PROJECT_RECEIPT_SECONDS };
        // Kept a little longer than the window, as the counters of other limits are
        const slot: ReceiptSlot = { type: 'project-receipt-slot', id: `slot_${window}_${free}`, pk, window, slot: free, receipt: id, workspaceId,
            projectId: receipt.projectId, createdAt: receipt.createdAt, ttl: limit.windowSeconds + 300 };
        if (await store.createAll([receipt, slot]))
            return receipt;
        // A write this session had not read yet: give it a moment to arrive before reading again
        await new Promise(resolve => setTimeout(resolve, Math.min(10 * (round + 1), 100)));
    }
    throw new ApiError(409, 'conflict', 'This request could not be saved. Try again.', 1);
}
