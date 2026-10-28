import type { AppDoc } from '../../app/model';
import { getAppStore, updateDoc, type AppStore } from '../../app/store';
import { IntegrationControlError } from '../delivery';
import type { IntegrationAdapter, IntegrationAttempt, IntegrationDeliveryContext } from '../model';
import { githubAppPk, processGitHubWebhookEvents, type GitHubUserAccess } from './webhook';
import { githubRequest, mintGitHubInstallationToken, validateGitHubRepository, type InstallationToken } from './client';
import { GitHubError, githubConfig, githubId, githubRepositoryPath, isGitHubConfigured } from './config';
import { githubIssueProjection, githubOwnershipMarker, githubPayloadHash, githubReplyMarker, githubReplyProjection, ownsGitHubContent } from './issue';
import { githubInstallationPk, type GitHubComment, type GitHubConnection, type GitHubDestination, type GitHubInstallation, type GitHubIssue, type GitHubState, type GitHubRepository } from './model';

type RateBucket = AppDoc & { type: 'github-rate'; nextWriteAt?: string; pausedUntil?: string };
function connectionOf(value: IntegrationDeliveryContext['connection']): GitHubConnection {
    const config = value.config;
    if (value.provider !== 'github' || typeof config.owner !== 'string' || typeof config.name !== 'string' || typeof config.markerSeed !== 'string'
        || typeof config.authorizedAt !== 'string' || !Number.isFinite(Date.parse(config.authorizedAt))) throw new GitHubError('invalid_mapping');
    [config.installationId, config.repositoryId, config.botId, config.authorizedGitHubUserId].forEach(githubId);
    githubRepositoryPath(config.owner, config.name);
    return value as GitHubConnection;
}
function stateOf(value: Record<string, unknown>): GitHubState {
    const state = structuredClone(value) as GitHubState;
    if (state.active !== undefined && (!state.active || typeof state.active !== 'object')) throw new GitHubError('invalid_ledger');
    if (state.retired === undefined) state.retired = [];
    if (!Array.isArray(state.retired) || state.retired.length > 20) throw new GitHubError('invalid_ledger');
    return state;
}
function freshDestination(connection: GitHubConnection, projectId: string, threadId: string): GitHubDestination {
    return { revision: connection.destinationRevision, installationId: connection.config.installationId,
        repositoryId: connection.config.repositoryId, repositoryNodeId: connection.config.repositoryNodeId,
        owner: connection.config.owner, name: connection.config.name, botId: connection.config.botId,
        marker: githubOwnershipMarker(connection.config.markerSeed, projectId, threadId), items: {},
        authorizedGitHubUserId: connection.config.authorizedGitHubUserId, authorizedAt: connection.config.authorizedAt };
}
function canonicalUrl(destination: GitHubDestination, number: number) {
    if (!Number.isSafeInteger(number) || number <= 0) throw new GitHubError('invalid_issue');
    githubRepositoryPath(destination.owner, destination.name);
    return `https://github.com/${destination.owner}/${destination.name}/issues/${number}`;
}

export function createGitHubAdapter(options: { store?: AppStore; writeIntervalMs?: number } = {}): IntegrationAdapter {
    return {
        provider: 'github', isConfigured: isGitHubConfigured, maxRunMs: 4 * 60_000, maxCalls: 60,
        async maintenance(budget) {
            if (!isGitHubConfigured()) return { calls: 0 };
            const result = await processGitHubWebhookEvents(budget, options.store ?? getAppStore());
            // Lifecycle receipts use only bounded storage operations, never GitHub requests.
            return { calls: 0, deferred: result.checked >= budget.maxCalls ? 1 : 0 };
        },
        async deliver(ctx) {
            const store = options.store ?? getAppStore();
            const connection = connectionOf(ctx.connection);
            const config = githubConfig();
            const state = stateOf(ctx.ledger.state);
            const tokens = new Map<string, InstallationToken>();
            let writes = 0;
            const checkpoint = (clearAttempt = false) => ctx.checkpoint(state, { clearAttempt });
            async function installationAuthority(destination: GitHubDestination) {
                const installation = (await store.get<GitHubInstallation>(githubInstallationPk(config.appId, githubId(destination.installationId)), 'installation'))?.doc;
                if (!installation || installation.type !== 'github-installation' || installation.appId !== config.appId || installation.status !== 'connected'
                    || installation.deniedRepositories.includes(destination.repositoryId)) throw new GitHubError('installation_unavailable');
                const revoked = (await store.get<GitHubUserAccess>(githubAppPk(config.appId), `user_${githubId(destination.authorizedGitHubUserId)}`))?.doc;
                if (revoked && Date.parse(revoked.revokedAt) >= Date.parse(destination.authorizedAt)) throw new GitHubError('authorization_revoked');
                if (installation.pausedUntil && Date.parse(installation.pausedUntil) > Date.now()) throw new GitHubError('rate_limited', 429, installation.pausedUntil);
                const bucket = (await store.get<RateBucket>(githubAppPk(config.appId), 'content-rate'))?.doc;
                if (bucket?.pausedUntil && Date.parse(bucket.pausedUntil) > Date.now()) throw new GitHubError('rate_limited', 429, bucket.pausedUntil);
            }
            async function token(destination: GitHubDestination, force = false) {
                await installationAuthority(destination);
                const key = `${destination.installationId}:${destination.repositoryId}`;
                const cached = tokens.get(key);
                if (!force && cached && Date.parse(cached.expiresAt) > Date.now() + 60_000) return cached.token;
                const minted = await ctx.read(signal => mintGitHubInstallationToken(destination.installationId, destination.repositoryId, signal));
                tokens.set(key, minted);
                return minted.token;
            }
            async function read<T>(destination: GitHubDestination, path: string): Promise<T> {
                let auth = await token(destination);
                try { return await ctx.read(signal => githubRequest<T>(path, auth, { signal })); }
                catch (error) {
                    if (!(error instanceof GitHubError) || error.status !== 401) throw error;
                    auth = await token(destination, true);
                    return ctx.read(signal => githubRequest<T>(path, auth, { signal }));
                }
            }
            async function pace() {
                if (writes >= 20) throw new IntegrationControlError('budget_exhausted');
                const pk = githubAppPk(config.appId);
                const interval = options.writeIntervalMs ?? 1100;
                for (let attempt = 0; attempt < 8; attempt++) {
                    const current = await store.get<RateBucket>(pk, 'content-rate');
                    const at = Math.max(Date.now(), Date.parse(current?.doc.nextWriteAt ?? '') || 0);
                    if (at + 1000 >= ctx.deadline) throw new IntegrationControlError('budget_exhausted');
                    const doc: RateBucket = { ...(current?.doc ?? { id: 'content-rate', pk, type: 'github-rate' as const }), nextWriteAt: new Date(at + interval).toISOString() };
                    if (current ? await store.replace(doc, current.etag) === 'ok' : await store.create(doc)) {
                        if (at > Date.now()) await new Promise(resolve => setTimeout(resolve, at - Date.now()));
                        writes++;
                        return;
                    }
                }
                throw new GitHubError('rate_reservation_busy');
            }
            async function write<T>(destination: GitHubDestination, step: string, method: string, path: string, body: unknown,
                metadata: Record<string, unknown> = {}, repeatable = true): Promise<T> {
                let auth = await token(destination);
                await pace();
                await publicationConsent(destination);
                try {
                    return await ctx.operation({ step, planHash: githubPayloadHash({ destination: [destination.installationId, destination.repositoryId], method, path, body }),
                        repeatable, metadata: { ...metadata, revision: destination.revision } }, signal => githubRequest<T>(path, auth, { method, body, signal }));
                } catch (error) {
                    // Definitive rejection means this operation did not copy content. Keep unknown creates for reconciliation.
                    if (error instanceof GitHubError && [401, 403, 404, 410, 422, 429].includes(error.status)) await checkpoint(true);
                    if (!(error instanceof GitHubError) || error.status !== 401) throw error;
                    auth = await token(destination, true);
                    await publicationConsent(destination);
                    return ctx.operation({ step, planHash: githubPayloadHash({ destination: [destination.installationId, destination.repositoryId], method, path, body }),
                        repeatable, metadata: { ...metadata, revision: destination.revision } }, signal => githubRequest<T>(path, auth, { method, body, signal }));
                }
            }
            async function refreshRepository(destination: GitHubDestination) {
                const value = await read<{ repositories: GitHubRepository[] }>(destination, '/installation/repositories?per_page=100');
                if (!Array.isArray(value?.repositories) || value.repositories.length !== 1) throw new GitHubError('invalid_repository_scope');
                const repository = validateGitHubRepository(value.repositories[0]);
                if (githubId(repository.id) !== destination.repositoryId || repository.archived || repository.disabled || repository.has_issues === false) throw new GitHubError('repository_unavailable');
                githubRepositoryPath(repository.owner?.login, repository.name);
                destination.owner = repository.owner.login;
                destination.name = repository.name;
                return repository;
            }
            async function publicationConsent(destination: GitHubDestination, repository?: GitHubRepository) {
                if (ctx.mode !== 'sync' || destination.revision !== connection.destinationRevision || !connection.config.private) return;
                const current = repository ?? await refreshRepository(destination);
                if (!current.private || connection.statusCode === 'public_confirmation_required') throw new GitHubError('public_confirmation_required');
            }
            async function issue(destination: GitHubDestination) {
                if (!destination.issue) throw new GitHubError('issue_missing');
                const value = await read<GitHubIssue>(destination, `${githubRepositoryPath(destination.owner, destination.name)}/issues/${destination.issue.number}`);
                if (value.pull_request || githubId(value.id) !== destination.issue.id || !ownsGitHubContent(value.body, destination.marker, value.user, destination.botId)) throw new GitHubError('ownership_changed');
                return value;
            }
            /** Bounded cursor scan, never treating a partial or uncertain empty scan as absence. */
            async function scan(destination: GitHubDestination, kind: 'issue' | 'comment', marker: string, itemId?: string, initial = false, receipt?: IntegrationAttempt) {
                const prior = destination.scan;
                if (!prior || prior.marker !== marker || prior.kind !== kind) destination.scan = { kind, marker, itemId, page: 1, pages: 0, rounds: 0, initial };
                const cursor = destination.scan!;
                const since = new Date(Math.max(0, Date.parse(initial ? connection.createdAt : receipt?.firstSentAt ?? ctx.ledger.attempt?.firstSentAt ?? connection.createdAt) - 5 * 60_000)).toISOString();
                for (let count = 0; count < 2; count++) {
                    if (cursor.pages >= 100) throw new GitHubError('reconciliation_limit');
                    const base = githubRepositoryPath(destination.owner, destination.name);
                    const path = kind === 'issue' ? `${base}/issues?state=all&sort=created&direction=desc&per_page=100&page=${cursor.page}&since=${encodeURIComponent(since)}`
                        : `${base}/issues/${destination.issue!.number}/comments?per_page=100&page=${cursor.page}&since=${encodeURIComponent(since)}`;
                    const values = await read<(GitHubIssue | GitHubComment)[]>(destination, path);
                    if (!Array.isArray(values)) throw new GitHubError('invalid_response');
                    for (const value of values) {
                        if ('pull_request' in value && value.pull_request) continue;
                        if (!ownsGitHubContent(value.body, marker, value.user, destination.botId)) continue;
                        const id = githubId(value.id);
                        if (cursor.match && cursor.match.id !== id) throw new GitHubError('duplicate_markers');
                        const number = kind === 'issue' ? (value as GitHubIssue).number : destination.issue!.number;
                        cursor.match = { id, number, url: canonicalUrl(destination, number) };
                    }
                    cursor.page++; cursor.pages++;
                    const last = values.at(-1);
                    const older = kind === 'issue' && last && 'created_at' in last && Number.isFinite(Date.parse(last.created_at)) && Date.parse(last.created_at) < Date.parse(since);
                    const complete = values.length < 100 || older;
                    await checkpoint();
                    if (complete) {
                        if (cursor.match) {
                            if (kind === 'issue') destination.issue = { ...cursor.match };
                            else destination.items[itemId!] = { id: cursor.match.id, marker, hash: '' };
                            destination.cleaned = false;
                            delete destination.scan;
                            await checkpoint();
                            return 'found' as const;
                        }
                        if (initial) { delete destination.scan; await checkpoint(); return 'absent' as const; }
                        cursor.rounds++;
                        if (cursor.rounds >= 3) throw new GitHubError('create_uncertain');
                        cursor.page = 1; cursor.pages = 0;
                        await checkpoint();
                        return 'waiting' as const;
                    }
                }
                return 'waiting' as const;
            }
            async function reconcile(destination: GitHubDestination, retained?: IntegrationAttempt) {
                const attempt = retained ?? ctx.ledger.attempt;
                if (!attempt) return true;
                if (attempt.metadata.revision !== destination.revision) throw new GitHubError('attempt_destination_mismatch');
                let found = false;
                if (attempt.step === 'create_issue') found = await scan(destination, 'issue', destination.marker, undefined, false, attempt) === 'found';
                else if (attempt.step === 'create_comment') {
                    const itemId = attempt.metadata.itemId;
                    const marker = attempt.metadata.marker;
                    if (typeof itemId !== 'string' || typeof marker !== 'string' || !destination.issue) throw new GitHubError('invalid_attempt');
                    found = await scan(destination, 'comment', marker, itemId, false, attempt) === 'found';
                } else {
                    // Known-id updates/deletes can be reconstructed from current desired state.
                    if (!attempt.repeatable || retained) throw new GitHubError('invalid_attempt');
                    if (destination.issue) await issue(destination);
                    found = true;
                }
                if (!found) return false;
                if (retained) destination.uncertainCreates = destination.uncertainCreates?.filter(value => value.operationId !== retained.operationId);
                await checkpoint(!retained);
                return true;
            }
            async function pauseForRate(error: GitHubError) {
                const pk = githubAppPk(config.appId);
                const pause = error.retryAt ?? new Date(Date.now() + 60_000).toISOString();
                await store.create<RateBucket>({ id: 'content-rate', pk, type: 'github-rate', pausedUntil: pause });
                await updateDoc<RateBucket>(pk, 'content-rate', current => ({ ...current,
                    pausedUntil: new Date(Math.max(Date.parse(current.pausedUntil ?? '') || 0, Date.parse(pause))).toISOString() }), store);
            }
            const cleanupErrors: GitHubError[] = [];
            const verifiedCleanupDestinations = new Set<GitHubDestination>();
            async function cleanupError(error: unknown) {
                if (error instanceof IntegrationControlError || !(error instanceof GitHubError)) throw error;
                cleanupErrors.push(error);
                if (error.code === 'rate_limited') await pauseForRate(error);
                // Cleanup writes are known-id and repeatable. Their ids remain in state until a
                // definitive response, so another reachable copy need not wait behind this write.
                if (ctx.ledger.attempt?.repeatable) await checkpoint(true);
            }
            async function cleanupRepository(destination: GitHubDestination) {
                if (verifiedCleanupDestinations.has(destination)) return;
                await refreshRepository(destination);
                verifiedCleanupDestinations.add(destination);
            }
            async function cleanupKnown(destination: GitHubDestination) {
                if (destination.cleaned && !destination.uncertainCreates?.length) return;
                if (!destination.issue && !Object.keys(destination.items).length) return;
                try { await cleanupRepository(destination); }
                catch (error) { await cleanupError(error); return; }
                const base = githubRepositoryPath(destination.owner, destination.name);
                const body = `This feedback was removed from uier. Existing copies are governed by GitHub.\n\n${destination.marker}`;
                const desired = { title: 'Removed from uier', body, state: 'closed', state_reason: 'completed' };
                let rootCleaned = !destination.issue;
                if (destination.issue) {
                    try {
                        const current = await issue(destination);
                        if (destination.issue.bodyHash !== githubPayloadHash(desired) || current.title !== desired.title || current.body !== desired.body || current.state !== desired.state) {
                            await write(destination, 'redact_issue', 'PATCH', `${base}/issues/${destination.issue.number}`, desired);
                            destination.issue.bodyHash = githubPayloadHash(desired);
                            destination.issue.status = 'closed';
                            await checkpoint(true);
                        }
                        rootCleaned = true;
                    } catch (error) { await cleanupError(error); }
                }
                for (const [itemId, item] of Object.entries(destination.items)) {
                    try {
                        let current: GitHubComment;
                        try { current = await read<GitHubComment>(destination, `${base}/issues/comments/${githubId(item.id)}`); }
                        catch (error) { if (error instanceof GitHubError && error.status === 404) { delete destination.items[itemId]; await checkpoint(); continue; } throw error; }
                        if (!ownsGitHubContent(current.body, item.marker, current.user, destination.botId)) throw new GitHubError('ownership_changed');
                        await write(destination, 'delete_comment', 'DELETE', `${base}/issues/comments/${item.id}`, undefined);
                        delete destination.items[itemId]; await checkpoint(true);
                    } catch (error) { await cleanupError(error); }
                }
                destination.cleaned = rootCleaned && !Object.keys(destination.items).length && !destination.uncertainCreates?.length;
                await checkpoint();
            }
            try {
                if (state.active && state.active.installationId === connection.config.installationId && state.active.repositoryId === connection.config.repositoryId
                    && state.active.botId === connection.config.botId && (state.active.authorizedGitHubUserId !== connection.config.authorizedGitHubUserId
                        || state.active.authorizedAt !== connection.config.authorizedAt)) {
                    // Explicit reauthorization of the same target renews access without changing
                    // external identity or forgetting an earlier operation's destination receipt.
                    state.active.authorizedGitHubUserId = connection.config.authorizedGitHubUserId;
                    state.active.authorizedAt = connection.config.authorizedAt;
                    await checkpoint();
                }
                if (ctx.mode === 'cleanup') {
                    const destinations = [...(state.active ? [state.active] : []), ...state.retired];
                    const attempt = ctx.ledger.attempt;
                    if (attempt) {
                        const attempted = destinations.find(destination => destination.revision === attempt.metadata.revision);
                        if (!attempted) throw new GitHubError('attempt_destination_mismatch');
                        if (!attempt.repeatable) {
                            if (!['create_issue', 'create_comment'].includes(attempt.step)) throw new GitHubError('invalid_attempt');
                            attempted.uncertainCreates ??= [];
                            if (!attempted.uncertainCreates.some(receipt => receipt.operationId === attempt.operationId)) attempted.uncertainCreates.push(structuredClone(attempt));
                            attempted.cleaned = false;
                        }
                        // One atomic checkpoint retains create uncertainty under the original
                        // authority before releasing the core's single operation slot for cleanup.
                        await checkpoint(true);
                    }
                    // Known copies get their bounded turn before any potentially long scan.
                    for (const destination of destinations) await cleanupKnown(destination);
                    let reconciling = false;
                    for (const destination of destinations) {
                        for (const receipt of [...(destination.uncertainCreates ?? [])]) {
                            try {
                                await cleanupRepository(destination);
                                if (!await reconcile(destination, receipt)) { reconciling = true; continue; }
                                await cleanupKnown(destination);
                            } catch (error) { await cleanupError(error); }
                        }
                    }
                    const limited = cleanupErrors.find(error => error.code === 'rate_limited');
                    if (limited) throw limited;
                    if (cleanupErrors.some(error => ['ownership_changed', 'duplicate_markers', 'create_uncertain', 'reconciliation_limit',
                        'attempt_destination_mismatch', 'invalid_attempt'].includes(error.code))) return { status: 'ambiguous', code: 'cleanup_needs_review' };
                    if (cleanupErrors.some(error => !['network_error', 'unavailable', 'invalid_response'].includes(error.code))) return { status: 'ambiguous', code: 'cleanup_blocked' };
                    if (reconciling || cleanupErrors.length || destinations.some(destination => destination.uncertainCreates?.length)) return { status: 'waiting', code: 'reconciling_cleanup' };
                    return { status: 'suppressed', code: 'removed_from_github' };
                }
                // One persisted operation may belong to any retained destination, including a
                // retired cleanup target. Reconcile that exact authority before changing targets.
                if (ctx.ledger.attempt) {
                    const attempted = [state.active, ...state.retired].find(destination => destination?.revision === ctx.ledger.attempt!.metadata.revision);
                    if (!attempted) throw new GitHubError('attempt_destination_mismatch');
                    await refreshRepository(attempted);
                    if (!await reconcile(attempted)) return { status: 'waiting', code: 'reconciling_previous_operation' };
                }
                // Cleanup can detach unknown creates, but becoming visible again never grants
                // permission to recreate them without reconciliation or an explicit human decision.
                for (const destination of [state.active, ...state.retired]) {
                    if (!destination) continue;
                    for (const receipt of [...(destination.uncertainCreates ?? [])]) {
                        await refreshRepository(destination);
                        if (!await reconcile(destination, receipt)) return { status: 'waiting', code: 'reconciling_previous_operation' };
                    }
                }
                if (state.active && state.active.revision !== connection.destinationRevision) {
                    await refreshRepository(state.active);
                    if (!await reconcile(state.active)) return { status: 'waiting', code: 'reconciling_previous_destination' };
                    if (state.active.repositoryId === connection.config.repositoryId && state.active.installationId === connection.config.installationId
                        && state.active.botId === connection.config.botId) {
                        state.active.revision = connection.destinationRevision;
                        state.active.authorizedAt = connection.config.authorizedAt;
                        state.active.authorizedGitHubUserId = connection.config.authorizedGitHubUserId;
                    } else {
                        if (state.retired.length >= 20) throw new GitHubError('destination_history_limit');
                        state.retired.push(state.active);
                        state.active = undefined;
                    }
                    await checkpoint();
                }
                if (!ctx.feedback) throw new GitHubError('missing_projection');
                if (!state.active) { state.active = freshDestination(connection, ctx.project.id, ctx.ledger.threadId); await checkpoint(); }
                const destination = state.active;
                const repository = await refreshRepository(destination);
                await publicationConsent(destination, repository);
                if (!await reconcile(destination)) return { status: 'waiting', code: 'reconciling_create' };
                if (!destination.issue) {
                    const found = await scan(destination, 'issue', destination.marker, undefined, true);
                    if (found === 'waiting') return { status: 'waiting', code: 'finding_existing_issue' };
                    if (found === 'absent') {
                        const projected = githubIssueProjection(ctx.feedback.context, destination.marker);
                        const created = await write<GitHubIssue>(destination, 'create_issue', 'POST', `${githubRepositoryPath(destination.owner, destination.name)}/issues`,
                            { title: projected.title, body: projected.body }, { marker: destination.marker }, false);
                        if (!ownsGitHubContent(created.body, destination.marker, created.user, destination.botId)) throw new GitHubError('invalid_create_response');
                        destination.issue = { id: githubId(created.id), number: created.number, url: canonicalUrl(destination, created.number) };
                        await checkpoint(true);
                    }
                }
                const current = await issue(destination);
                const projection = githubIssueProjection(ctx.feedback.context, destination.marker);
                const desired = { title: projection.title, body: projection.body, state: projection.state };
                const hash = githubPayloadHash(desired);
                if (destination.issue!.bodyHash !== hash || current.title !== desired.title || current.body !== desired.body || current.state !== desired.state) {
                    await write(destination, 'update_issue', 'PATCH', `${githubRepositoryPath(destination.owner, destination.name)}/issues/${destination.issue!.number}`, desired);
                    destination.issue!.bodyHash = hash; destination.issue!.status = projection.state; destination.cleaned = false;
                    await checkpoint(true);
                }
                const liveIds = new Set(ctx.feedback.context.discussion.map(item => item.id));
                for (const item of ctx.feedback.context.discussion) {
                    const marker = githubReplyMarker(destination.marker, item.id);
                    const body = githubReplyProjection(item, marker);
                    const hash = githubPayloadHash(body);
                    let known = destination.items[item.id];
                    if (!known) {
                        const found = await scan(destination, 'comment', marker, item.id, true);
                        if (found === 'waiting') return { status: 'waiting', code: 'finding_existing_comment' };
                        known = destination.items[item.id];
                        if (found === 'absent') {
                            const created = await write<GitHubComment>(destination, 'create_comment', 'POST', `${githubRepositoryPath(destination.owner, destination.name)}/issues/${destination.issue!.number}/comments`,
                                { body }, { marker, itemId: item.id }, false);
                            if (!ownsGitHubContent(created.body, marker, created.user, destination.botId)) throw new GitHubError('invalid_create_response');
                            known = destination.items[item.id] = { id: githubId(created.id), marker, hash };
                            await checkpoint(true);
                        }
                    }
                    if (known && known.hash !== hash) {
                        const existing = await read<GitHubComment>(destination, `${githubRepositoryPath(destination.owner, destination.name)}/issues/comments/${known.id}`);
                        if (!ownsGitHubContent(existing.body, marker, existing.user, destination.botId)) throw new GitHubError('ownership_changed');
                        await write(destination, 'update_comment', 'PATCH', `${githubRepositoryPath(destination.owner, destination.name)}/issues/comments/${known.id}`, { body });
                        known.hash = hash; await checkpoint(true);
                    }
                }
                for (const [itemId, known] of Object.entries(destination.items)) {
                    if (liveIds.has(itemId)) continue;
                    const body = `This reply was deleted in uier.\n\n${known.marker}`;
                    const hash = githubPayloadHash(body);
                    if (known.hash === hash) continue;
                    const existing = await read<GitHubComment>(destination, `${githubRepositoryPath(destination.owner, destination.name)}/issues/comments/${known.id}`);
                    if (!ownsGitHubContent(existing.body, known.marker, existing.user, destination.botId)) throw new GitHubError('ownership_changed');
                    await write(destination, 'delete_reply_text', 'PATCH', `${githubRepositoryPath(destination.owner, destination.name)}/issues/comments/${known.id}`, { body });
                    known.hash = hash; await checkpoint(true);
                }
                return { status: 'accepted', ...(projection.truncated ? { code: 'content_truncated' } : {}) };
            } catch (error) {
                if (error instanceof IntegrationControlError) throw error;
                if (!(error instanceof GitHubError)) throw error;
                if (error.code === 'rate_limited') {
                    await pauseForRate(error);
                    return { status: 'waiting', code: error.code, retryAt: error.retryAt };
                }
                if (ctx.ledger.attempt && !ctx.ledger.attempt.repeatable && ['network_error', 'unavailable', 'invalid_response', 'invalid_create_response'].includes(error.code))
                    return { status: 'waiting', code: 'create_response_unknown' };
                if (['ownership_changed', 'duplicate_markers', 'create_uncertain', 'reconciliation_limit', 'attempt_destination_mismatch', 'destination_history_limit'].includes(error.code))
                    return { status: 'ambiguous', code: error.code };
                if (error.code === 'not_found') return { status: 'ambiguous', code: ctx.mode === 'cleanup' ? 'cleanup_blocked' : 'target_missing' };
                if (['unauthorized', 'authorization_revoked'].includes(error.code)) return { status: 'needs_reconnect', code: error.code };
                if (['forbidden', 'installation_unavailable', 'repository_unavailable', 'invalid_repository_scope', 'invalid_mapping', 'public_confirmation_required'].includes(error.code))
                    return { status: 'paused', code: ctx.mode === 'cleanup' ? 'cleanup_blocked' : error.code };
                return { status: 'failed', code: error.code };
            }
        },
        externalLink(connection, ledger) {
            const state = stateOf(ledger.state);
            return state.active?.revision === connection.destinationRevision && !state.active.cleaned && state.active.issue ? state.active.issue.url : null;
        },
        validateExternalLink(url, connection, ledger) {
            const state = stateOf(ledger.state);
            const destination = state.active;
            return Boolean(destination?.issue && destination.revision === connection.destinationRevision && url.href === canonicalUrl(destination, destination.issue.number));
        }
    };
}

export const githubAdapter = createGitHubAdapter();
