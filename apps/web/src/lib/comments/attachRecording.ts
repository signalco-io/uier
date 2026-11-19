import type { DbComment } from '../db/schema';
import type { CommentsStore } from '../repo/commentsStore';
import { attachRecording, prepareCommentRecording } from '../recordings/service';
import { ApiError, apiErrors } from './http';
import { commitRecordingSubmission, recoverSubmission, submission } from './submissions';

/** One recording per message, and only on a first message that is still there. */
function assertTakesRecording(comment: DbComment) {
    const first = comment.thread.items[0];
    if (!first || first.deletedAt) throw apiErrors.notFound();
    if (comment.recording) throw new ApiError(409, 'conflict', 'This comment already has a recording.');
}

/**
 * Adds a finalized recording to a saved comment's first message. The upload must be the caller's own
 * (`prepareCommentRecording`), `authorize` rechecks visibility and edit rights on every attempt, and the
 * comment, the upload's claim and a receipt keyed by the recording commit together: a retry after a lost
 * response returns the saved comment, and one upload is never attached to two messages.
 *
 * Two requests for the same recording can overlap (a retry sent while the first is still committing). The
 * one that loses then finds the comment with its recording (409) or the upload already claimed (404), at
 * any read after its own receipt lookup. That is the saved result, not a failure: the receipt is read again
 * before either answer, and the recovered comment is authorized like any other. A different upload has no
 * receipt for this attempt, so it keeps its conflict.
 */
export async function attachSavedRecording(
    store: CommentsStore, domain: string, authorId: string, id: string, recordingId: string,
    authorize: (comment: DbComment) => void | Promise<void>,
    finalize: (previous: DbComment, updated: DbComment) => DbComment = (_, updated) => updated
) {
    const attempt = submission(domain, authorId, recordingId, { operation: 'recording', id, recordingId })!;
    const saved = async () => {
        const recovered = await recoverSubmission(store, attempt);
        if (recovered) await authorize(recovered);
        return recovered;
    };
    const recovered = await saved();
    if (recovered) return recovered;
    try {
        const stored = await store.get(domain, id);
        if (!stored) throw apiErrors.notFound();
        await authorize(stored.comment);
        assertTakesRecording(stored.comment);
        const recording = (await prepareCommentRecording(domain, authorId, recordingId, store))!;
        const metadata = recording.doc.metadata!;
        const now = new Date().toISOString();
        return await commitRecordingSubmission(store, attempt, id, authorize, comment => {
            assertTakesRecording(comment);
            return finalize(comment, { ...comment, recording: metadata, updatedAt: now });
        }, attachRecording(recording, id)!);
    } catch (error) {
        // Only what a concurrent commit of this same attempt explains; never a refusal of the caller
        if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 409)) throw error;
        const concurrent = await saved();
        if (concurrent) return concurrent;
        throw error;
    }
}
