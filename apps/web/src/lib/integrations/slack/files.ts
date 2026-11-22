import type { FeedbackContext } from '@uier/toolbar/feedback-context';
import { sha256Hex } from '../../app/tokens';
import { ApiError } from '../../comments/http';
import type { DbComment, DbCommentRecording, DbCommentScreenshot } from '../../db/schema';
import { MAX_RECORDING_BYTES } from '../../recordings/blobStore';
import { commentRecordingBytes } from '../../recordings/service';
import { getProjectComment, getProjectScreenshot } from '../../review/comments';
import { screenshotBytes } from '../../screenshots/blobStore';
import type { AppI18n } from '../../i18n/types';
import type { IntegrationDeliveryContext } from '../model';
import { SlackApiError, slackRequest, slackUpload, type SlackMethod } from './client';
import { slackFileScopes, slackId, slackUploadUrl } from './config';
import type { SlackConnection, SlackFile, SlackGrant, SlackState } from './model';
import { withSlackRateLimit } from './rate';
import { eligibleChannel } from './settings';

type Source = { key: string; kind: 'screenshot' | 'recording'; itemId?: string; revision: string; contentType: string };
type Session = { context: IntegrationDeliveryContext; state: SlackState; grant: SlackGrant; token: string };

/** Slack will not take this file, whatever is retried: remembered per revision. */
const refused = ['blocked_file_type', 'file_type_not_allowed', 'file_uploads_except_images_disabled', 'file_uploads_disabled',
    'slack_connect_blocked_file_type', 'slack_connect_file_upload_sharing_blocked', 'slack_connect_clip_sharing_blocked'];
/** The app may not share or delete files here. The message itself is unaffected, so the files wait for a reconnect. */
const denied = ['missing_scope', 'no_permission', 'access_denied', 'not_allowed_token_type', 'posting_to_channel_denied',
    'cant_delete_file', 'delete_not_allowed', 'file_deleting_disabled'];
const extensions: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/webm': 'webm' };

/** Every screenshot and recording the thread still has. A deleted message has none. */
function threadFiles(comment: DbComment, packet: FeedbackContext): Source[] {
    const sources: Source[] = [];
    const add = (owner: string, itemId: string | undefined, image: DbCommentScreenshot | undefined, video: DbCommentRecording | undefined) => {
        // Older images have no revision; their type and size stand in for one.
        if (image) sources.push({ key: `${owner}:screenshot`, kind: 'screenshot', itemId, contentType: image.contentType,
            revision: image.revision ?? sha256Hex(JSON.stringify([image.contentType, image.width, image.height, image.bytes])) });
        if (video) sources.push({ key: `${owner}:recording`, kind: 'recording', itemId, contentType: video.contentType, revision: video.id });
    };
    if (packet.feedback && !packet.feedback.deleted)
        add('root', undefined, packet.screenshot.state === 'protected' ? comment.screenshot : undefined, comment.recording);
    // The packet lists the replies this connection may show, and which of them still have a stored image.
    const replies = new Map(packet.discussion.filter(item => !item.deleted).map(item => [item.id, item]));
    for (const item of comment.thread.items) {
        const reply = replies.get(item.id);
        if (reply && !item.deletedAt) add(item.id, item.id, reply.screenshot ? item.screenshot : undefined, item.recording);
    }
    return sources;
}

/** Deletes one of the app's own files. Slack answering that it is already gone counts as deleted. */
async function removeFile({ context, state, grant, token }: Session, file: SlackFile) {
    try {
        await withSlackRateLimit(grant, 'files.delete', undefined, () => context.operation({ step: 'delete_file', planHash: sha256Hex(`delete:${file.fileId}`),
            repeatable: true, metadata: { fileId: file.fileId, teamId: file.teamId, channelId: file.channelId } },
        signal => slackRequest('files.delete', { file: file.fileId }, { token, signal })), context.deadline);
    } catch (error) {
        if (error instanceof SlackApiError && error.definitive) await context.checkpoint(state, { clearAttempt: true });
        if (!(error instanceof SlackApiError && ['file_not_found', 'file_deleted'].includes(error.code))) throw error;
    }
    state.files = state.files?.filter(item => item.fileId !== file.fileId);
    await context.checkpoint(state, { clearAttempt: true });
}

/**
 * Keeps the files under the current message equal to the thread's screenshots and recordings.
 * A copy whose source changed or is gone is deleted even when sending files is off; a new copy
 * is uploaded only when it is on. Returns a code when a file could not be sent, and never fails
 * the message for it.
 *
 * Slack returns a file's id before any bytes leave, so an upload whose outcome is unknown is deleted
 * by that id and sent again. That makes sharing repeatable without reading the channel's history.
 */
export async function syncSlackFiles(session: Session & { connection: SlackConnection; i18n: AppI18n }): Promise<string | undefined> {
    const { context, state, grant, token, connection, i18n: { t } } = session;
    const enabled = connection.config.files === true && slackFileScopes.every(scope => grant.scopes.includes(scope));
    if (!context.feedback || (!enabled && !state.files?.length)) return;
    const packet = context.feedback.context;
    const actor = { kind: 'member' as const, userId: connection.connectedBy, name: 'uier integration', isAdmin: true };
    let stored: DbComment | null;
    try { stored = await context.read(() => getProjectComment(context.project, actor, context.ledger.threadId)); }
    catch (error) { if (error instanceof ApiError) return; throw error; }
    if (!stored) return;
    const comment = stored;
    const sources = threadFiles(comment, packet);
    let code: string | undefined;
    try {
        for (const file of [...(state.files ?? [])]) {
            const source = sources.find(item => item.key === file.key);
            if (source?.revision === file.revision && file.shared) continue;
            // Another workspace's files are out of reach until cleanup reports them.
            if (file.teamId === grant.teamId) await removeFile(session, file);
        }
        const root = state.root;
        if (!enabled || !root || state.suppressed || state.missing) return;
        const threadTs = root.threadTs ?? root.ts;
        const read = (method: SlackMethod, payload: Record<string, unknown>) => withSlackRateLimit(grant, method, undefined,
            () => context.read(signal => slackRequest(method, payload, { token, signal })), context.deadline);
        const base = `uier-${packet.identity.number ?? 'feedback'}`;
        for (const source of sources) {
            // A reply's files follow its copy in the Slack thread; without that copy they would have no context.
            if (source.itemId && !root.replySync?.copies?.[source.itemId]) continue;
            if (state.files?.some(file => file.key === source.key && file.teamId === root.teamId && file.channelId === root.channelId && file.rootTs === threadTs)) continue;
            if (state.skippedFiles?.some(item => item.key === source.key && item.revision === source.revision)) { code ??= 'file_refused'; continue; }
            let bytes: Buffer;
            try {
                bytes = await context.read(async () => source.kind === 'recording' ? (await commentRecordingBytes(comment, source.itemId)).bytes
                    : screenshotBytes(await getProjectScreenshot(context.project, actor, context.ledger.threadId, source.itemId)));
            } catch (error) { if (error instanceof ApiError) { code ??= 'file_unavailable'; continue; } throw error; }
            if (!bytes.length || bytes.length > MAX_RECORDING_BYTES) { code ??= 'file_unavailable'; continue; }
            const image = source.kind === 'screenshot';
            const reserved = await read('files.getUploadURLExternal', { filename: `${base}${source.itemId ? '-reply' : ''}-${source.kind}.${extensions[source.contentType] ?? 'bin'}`,
                length: bytes.length, ...(image ? { alt_txt: t('Screenshot saved with this feedback in uier.') } : {}) });
            if (!slackId(reserved.file_id) || !slackUploadUrl(reserved.upload_url)) throw new SlackApiError(200, 'invalid_upload_response');
            const file: SlackFile = { key: source.key, revision: source.revision, fileId: reserved.file_id, teamId: root.teamId, channelId: root.channelId, rootTs: threadTs };
            state.files = [...(state.files ?? []), file];
            await context.checkpoint(state);
            // Fixed words in the project's review language, set when the file is sent; never reviewer text.
            const title = t(source.itemId ? image ? 'Screenshot from a reply' : 'Recording from a reply' : image ? 'Screenshot' : 'Recording');
            const timeout = (max: number) => AbortSignal.timeout(Math.max(1, Math.min(max, context.deadline - Date.now())));
            try {
                await withSlackRateLimit(grant, 'files.completeUploadExternal', root.channelId, async () => {
                    // Check after the posting slot wait, as for messages: saved metadata cannot authorize later Slack Connect access.
                    const metadata = await read('conversations.info', { channel: root.channelId });
                    if (!eligibleChannel(metadata.channel) || metadata.channel.id !== root.channelId) throw new SlackApiError(200, 'channel_ineligible');
                    return context.operation({ step: 'share_file', planHash: sha256Hex(`share:${file.fileId}:${file.revision}:${root.channelId}:${threadTs}`), repeatable: true,
                        metadata: { fileId: file.fileId, teamId: root.teamId, channelId: root.channelId, ts: threadTs } }, async () => {
                        await slackUpload(reserved.upload_url, bytes, { signal: timeout(60_000) });
                        return slackRequest('files.completeUploadExternal', { files: [{ id: file.fileId, title }], channel_id: root.channelId, thread_ts: threadTs },
                            { token, signal: timeout(20_000) });
                    });
                }, context.deadline);
            } catch (error) {
                if (!(error instanceof SlackApiError) || !error.definitive) throw error;
                // Slack discards an upload that was never completed, so there is no copy to delete.
                state.files = state.files?.filter(item => item.fileId !== file.fileId);
                const permanent = refused.includes(error.code);
                if (permanent) state.skippedFiles = [...(state.skippedFiles ?? []).filter(item => item.key !== source.key), { key: source.key, revision: source.revision, code: error.code }];
                await context.checkpoint(state, { clearAttempt: true });
                if (!permanent && error.code !== 'upload_failed') throw error;
                code ??= permanent ? 'file_refused' : 'file_upload_failed';
                continue;
            }
            file.shared = true;
            await context.checkpoint(state, { clearAttempt: true });
        }
    } catch (error) {
        if (error instanceof SlackApiError && denied.includes(error.code)) return 'files_permission_required';
        throw error;
    }
    return code;
}

/** Privacy cleanup: every known file goes, with or without the setting. The result feeds the adapter's cleanup verdict. */
export async function cleanupSlackFiles(session: Session, current: { teamId: string; channelId: string }) {
    const { state, grant } = session;
    const result = { unreachable: false, denied: false, currentDenied: false };
    for (const file of [...(state.files ?? [])]) {
        if (file.teamId !== grant.teamId) { result.unreachable = true; continue; }
        try { await removeFile(session, file); }
        catch (error) {
            if (!(error instanceof SlackApiError && denied.includes(error.code))) throw error;
            result.denied = true;
            if (file.teamId === current.teamId && file.channelId === current.channelId && error.code !== 'cant_delete_file') result.currentDenied = true;
        }
    }
    state.skippedFiles = undefined;
    return result;
}
