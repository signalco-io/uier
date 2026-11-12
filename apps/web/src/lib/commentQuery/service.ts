import { createHash, timingSafeEqual } from 'node:crypto';
import { compareQueryRecords, evaluateQuery, fieldRegistry, queryCapabilities, queryFields, QueryValidationError, serializeQuery, type Condition, type EvaluationContext, type Expression, type FieldId, type QueryDocument, type QueryRecord } from '@uier/comments-query';
import type { DbProject } from '../app/model';
import { getWorkspace } from '../app/workspaces';
import { keyedHash } from '../comments/environment';
import { apiErrors } from '../comments/http';
import { readActivity } from '../comments/activity';
import { loadReadSequences } from '../comments/readState';
import { configuredEnvironments, environmentOptions, feedbackSource } from '../app/environments';
import { actorAuthorId, type ProjectActor } from '../review/actor';
import { commentVisibilityFilter } from '../review/comments';
import { participantNames } from '../review/dto';
import { getCommentsStore } from '../repo/commentsStore';
import { CommentQueryBudgetError, type CommentQueryCandidate } from '../repo/commentQuerySource';
import { threadTitle } from '../titles/model';
import { aiTitlesEnabled } from '../titles/settings';
import { effectiveThreadLabels } from '../app/threadLabels';
import { labelsForComment, type ThreadLabel } from '../app/threadLabel';
import type { DbComment } from '../db/schema';
import { compileCandidatePredicate } from './predicate';
import type { OriginFilter } from '../repo/originFilter';

/** Built by route adapters only after fresh project/membership authorization. Never accept these from JSON. */
export type QuerySource = { domain: string; project?: DbProject; actor: ProjectActor };
export type QueryExecutionContext = { sources: QuerySource[]; scope: QueryDocument['scope']; signal?: AbortSignal; currentPage?: string; currentEnvironment?: string };
export type QueryPage = { size?: number; cursor?: string };
export type QueryItem = { id: string; scopeKey: string; projectId?: string; number?: number; path: string; title?: { text: string; ai: boolean }; excerpt: string; status: string; priority: string; unread: boolean; replies: number; screenshot: boolean; private: boolean; createdAt?: string; updatedAt?: string; completedAt?: string; archivedAt?: string; environment: string; revision: string };
type Row = { record: QueryRecord; item: QueryItem };
const memberOnly: readonly FieldId[] = ['labels', 'assignee', 'mentions', 'agents'];
const identifiedOnly: readonly FieldId[] = ['openedBy', 'author', 'unread'];
const adminOnly: readonly FieldId[] = ['device', 'browser', 'width', 'height'];
const admin = (sources: QuerySource[]) => sources.every(s => s.actor.kind === 'member' && s.actor.isAdmin);
const member = (sources: QuerySource[]) => sources.every(s => s.actor.kind === 'member');
export function allowedQueryFields(sources: QuerySource[]): FieldId[] {
    return queryFields.filter(field => (!memberOnly.includes(field) || member(sources)) && (!identifiedOnly.includes(field) || sources.every(s => actorAuthorId(s.actor))) && (!adminOnly.includes(field) || admin(sources)));
}
export function capabilities(sources: QuerySource[]) {
    return { ...queryCapabilities(allowedQueryFields(sources)), namedAuthors: admin(sources), pagination: 'live-keyset' as const,
        totals: 'exact' as const, facetable: allowedQueryFields(sources).filter(field => ['enum', 'set', 'boolean'].includes(fieldRegistry[field].type) && (!['author', 'openedBy'].includes(field) || admin(sources))), optionsPageSize: 100, pageSize: 100 };
}
function conditions(expression: Expression | undefined): Condition[] {
    if (!expression) return [];
    if ('all' in expression) return expression.all.flatMap(conditions);
    if ('any' in expression) return expression.any.flatMap(conditions);
    if ('not' in expression) return conditions(expression.not);
    return [expression];
}
export function assertQueryCapabilities(query: QueryDocument, context: QueryExecutionContext) {
    if (JSON.stringify(query.scope) !== JSON.stringify(context.scope)) throw apiErrors.invalidRequest('The query scope does not match this endpoint.');
    const allowed = allowedQueryFields(context.sources);
    for (const condition of conditions(query.where)) {
        if (!allowed.includes(condition.field)) throw apiErrors.forbidden(`Filtering by ${condition.field} is not available to this reviewer.`);
        if ((condition.field === 'author' || condition.field === 'openedBy') && !admin(context.sources)) {
            const values = Array.isArray(condition.value) ? condition.value : [condition.value];
            if (!values.every(value => value && typeof value === 'object' && 'relative' in value && value.relative === 'me'))
                throw apiErrors.forbidden('Only admins can filter by a named author.');
        }
    }
    for (const sort of query.order) if (!allowed.includes(sort.field) || (sort.field === 'openedBy' && !admin(context.sources)))
        throw apiErrors.forbidden(`Sorting by ${sort.field} is not available to this reviewer.`);
    if (query.location?.page?.kind === 'current' && !context.currentPage) throw apiErrors.invalidRequest('The current page is required.');
    if (query.location?.environmentIds?.includes('current') && !context.currentEnvironment) throw apiErrors.invalidRequest('The current environment is required.');
}
const validTime = (...values: (string | undefined)[]) => {
    for (const value of values) { const time = Date.parse(value ?? ''); if (Number.isFinite(time)) return new Date(time).toISOString(); }
    return undefined;
};
function hasVisibleFixLink(candidate: CommentQueryCandidate, source: QuerySource) {
    if (!candidate.verification?.fixUrl) return false;
    if (source.actor.kind === 'member') return true;
    if (!source.project) return false;
    try {
        const fixOrigin = new URL(candidate.verification.fixUrl).origin;
        return feedbackSource(source.project, candidate.origin).available
            && (!source.project.urls.some(url => new URL(url).origin === fixOrigin) || fixOrigin === candidate.origin);
    } catch { return false; }
}
const person = (id: string) => id.startsWith('user:') ? id : `user:${id}`;
export function queryRow(candidate: CommentQueryCandidate, source: QuerySource, titles: boolean, readSequence: number, names: Map<string, string> = new Map(), labels: ThreadLabel[] = []): Row {
    const items = candidate.thread.items.filter(item => !item.deletedAt);
    // The title model reads only these fields. The source deliberately omits heavy anchors/screenshots.
    const title = threadTitle(candidate as DbComment, titles);
    const first = candidate.thread.items[0];
    const excerpt = first && !first.deletedAt ? (first.text ?? '').slice(0, 240) : '';
    const text = items.flatMap(item => [item.text ?? '', item.quotedText ?? '']).join('\n');
    const authorName = (id: string | undefined, fallback?: string) => id?.startsWith('user:') ? names.get(id.slice(5)) ?? 'Former member' : fallback ?? 'Guest';
    const status = candidate.resolved ? 'done' : candidate.verification?.outcome === 'pending' ? 'ready' : candidate.inProgress ? 'in-progress' : 'open';
    const priority = ['urgent', 'high', 'low'].includes(candidate.priority ?? '') ? candidate.priority! : 'normal';
    const assignees = candidate.assigneeIds ?? (candidate.assigneeId ? [candidate.assigneeId] : []);
    const environment = source.project ? feedbackSource(source.project, candidate.origin).environment : candidate.origin || 'unknown';
    const created = validTime(candidate.createdAt), updated = validTime(candidate.updatedAt, candidate.createdAt);
    const completed = validTime(candidate.completedAt, ...(candidate.resolved ? [candidate.updatedAt, candidate.createdAt] : []));
    const archived = candidate.archivedAt ? validTime(candidate.archivedAt, candidate.updatedAt, candidate.createdAt) : undefined;
    const unread = readActivity(candidate as DbComment, actorAuthorId(source.actor), readSequence).unread;
    const record: QueryRecord = { id: candidate.id, scopeKey: source.domain, fields: {
        ...(source.actor.kind === 'member' ? { labels: labelsForComment(labels, candidate).map(label => label.id) } : {}),
        status, priority, assignee: assignees.map(person), openedBy: candidate.authorId,
        author: [...new Set([candidate.authorId, ...items.map(item => item.authorId)].filter(Boolean))],
        mentions: [...new Set(items.flatMap(item => item.mentions?.map(mention => person(mention.userId)) ?? []))],
        agents: [...new Set((candidate.assigneeAgents ?? (candidate.assigneeAgent ? [candidate.assigneeAgent] : []))
            .filter(agent => assignees.includes(agent.assigneeId)).map(agent => agent.kind))],
        project: source.project?.id ?? candidate.projectId, environment, page: candidate.path,
        title: title?.text, text, unread, private: candidate.private === true, screenshot: candidate.hasScreenshot,
        replies: Math.max(0, candidate.thread.items.length - 1), fixLink: hasVisibleFixLink(candidate, source),
        created, updated, completed, archived, number: candidate.number, kind: candidate.kind ?? 'comment',
        verification: candidate.verification?.outcome, device: candidate.device?.size, browser: candidate.device?.browser,
        width: candidate.device?.windowSize?.[0], height: candidate.device?.windowSize?.[1]
    }, searchText: [candidate.path, candidate.number ? `#${candidate.number}` : '', title?.text ?? '', text,
        ...items.map(item => authorName(item.authorId, item.authorName)),
        ...(source.actor.kind === 'member' ? assignees.map(id => names.get(id) ?? '') : [])].join('\n') };
    return { record, item: { id: candidate.id, scopeKey: source.domain, projectId: source.project?.id, number: candidate.number,
        path: candidate.path, title, excerpt, status, priority, unread: Boolean(actorAuthorId(source.actor)) && unread,
        replies: Number(record.fields.replies), screenshot: candidate.hasScreenshot, private: candidate.private === true,
        createdAt: created, updatedAt: updated, completedAt: completed, archivedAt: archived, environment, revision: candidate.revision } };
}
function binding(query: QueryDocument, context: QueryExecutionContext) {
    return createHash('sha256').update(serializeQuery(query)).update(JSON.stringify({
        sources: context.sources.map(s => [s.domain, s.project?.id, s.actor]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        page: context.currentPage, environment: context.currentEnvironment
    })).digest('hex');
}
type Cursor = { binding: string; evaluationTime: string; after: QueryRecord; exp: number };
function encodeCursor(value: Cursor) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${body}.${keyedHash('comment-query-cursor-v1', body)}`;
}
function decodeCursor(token: string, expected: string): Cursor {
    if (token.length > 32768) throw apiErrors.invalidRequest('Invalid query cursor.');
    const [body, signature, ...rest] = token.split('.');
    const expectedSignature = Buffer.from(keyedHash('comment-query-cursor-v1', body ?? ''));
    const actual = Buffer.from(signature ?? '');
    if (rest.length || actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) throw apiErrors.invalidRequest('Invalid query cursor.');
    try {
        const cursor = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Cursor;
        if (cursor.binding !== expected || cursor.exp <= Date.now() || !Number.isFinite(Date.parse(cursor.evaluationTime))
            || !cursor.after || typeof cursor.after.id !== 'string' || typeof cursor.after.scopeKey !== 'string' || !cursor.after.fields) throw new Error();
        return cursor;
    } catch { throw apiErrors.invalidRequest('The query cursor expired or belongs to a different query.'); }
}
/** Environment IDs describe configured groups, removed sources and unknown legacy sources. */
function locationOriginFilter(query: QueryDocument, source: QuerySource, current?: string): OriginFilter | undefined {
    if (!source.project || !query.location?.environmentIds?.length) return undefined;
    const selected = query.location.environmentIds.map(id => id === 'current' ? current : id);
    const configured = configuredEnvironments(source.project);
    const wanted = configured.filter(item => selected.includes(feedbackSource(source.project!, item.origin).environment)).map(item => item.origin);
    return selected.includes('removed')
        ? { origins: configured.map(item => item.origin).filter(origin => !wanted.includes(origin)), exclude: true, unknown: selected.includes('unknown') }
        : { origins: wanted, unknown: selected.includes('unknown') };
}
async function matchingRows(query: QueryDocument, context: QueryExecutionContext, evaluationTime: string) {
    assertQueryCapabilities(query, context);
    if (context.sources.length > 100) throw new CommentQueryBudgetError();
    const rows: Row[] = [];
    const started = performance.now();
    // Bounded fanout and one global deadline, rather than one budget for each workspace project.
    const signal = context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
    let index = 0, candidatesSeen = 0, bytes = 0;
    await Promise.all(Array.from({ length: Math.min(4, context.sources.length) }, async () => {
        while (index < context.sources.length) {
            const source = context.sources[index++]!;
            const viewerId = actorAuthorId(source.actor);
            const evaluation: EvaluationContext = { viewerId, evaluationTime, currentPage: context.currentPage, currentEnvironment: context.currentEnvironment };
            const [candidates, reads, workspace, names] = await Promise.all([
                getCommentsStore().queryCandidates(source.domain, { origin: locationOriginFilter(query, source, context.currentEnvironment), visibility: commentVisibilityFilter(source.domain, source.actor),
                    archive: query.collection === 'archived' ? 'only' : 'exclude', predicate: compileCandidatePredicate(query, evaluation),
                    maxRequestCharge: Math.max(1, Math.floor(10000 / Math.max(1, context.sources.length))), signal }),
                loadReadSequences(source.domain, viewerId), source.project ? getWorkspace(source.project.workspaceId) : null,
                source.project ? participantNames(source.project) : new Map<string, string>()
            ]);
            candidatesSeen += candidates.length;
            bytes += Buffer.byteLength(JSON.stringify(candidates));
            if (candidatesSeen > 100000 || bytes > 32 * 1024 * 1024 || performance.now() - started > 5000) throw new CommentQueryBudgetError();
            const labels = source.project ? effectiveThreadLabels(workspace, source.project) : [];
            for (const candidate of candidates) {
                signal.throwIfAborted();
                if (performance.now() - started > 5000) throw new CommentQueryBudgetError();
                const row = queryRow(candidate, source, source.project ? aiTitlesEnabled(workspace, source.project) : false, reads.get(candidate.id) ?? 0, names, labels);
                if (evaluateQuery(row.record, query, evaluation)) rows.push(row);
            }
        }
    }));
    if (performance.now() - started > 5000) throw new CommentQueryBudgetError();
    return rows;
}
export async function executeQuery(query: QueryDocument, context: QueryExecutionContext, page: QueryPage = {}) {
    assertQueryCapabilities(query, context);
    const size = page.size ?? 50;
    if (!Number.isSafeInteger(size) || size < 1 || size > 100) throw apiErrors.invalidRequest('Page size must be between 1 and 100.');
    const key = binding(query, context), cursor = page.cursor ? decodeCursor(page.cursor, key) : undefined;
    const evaluationTime = cursor?.evaluationTime ?? new Date().toISOString();
    const rows = await matchingRows(query, context, evaluationTime);
    rows.sort((a, b) => compareQueryRecords(a.record, b.record, query.order));
    const remaining = cursor ? rows.filter(row => compareQueryRecords(row.record, cursor.after, query.order) > 0) : rows;
    const selected = remaining.slice(0, size), last = selected.at(-1);
    const after = last ? { ...last.record, fields: Object.fromEntries(query.order.map(sort => [sort.field, last.record.fields[sort.field]])), searchText: '' } : undefined;
    return { version: 1, items: selected.map(row => row.item), total: rows.length, evaluationTime,
        nextCursor: remaining.length > size && after ? encodeCursor({ binding: key, evaluationTime, after, exp: cursor?.exp ?? Date.now() + 15 * 60 * 1000 }) : null };
}
export async function queryFacets(query: QueryDocument, context: QueryExecutionContext, fields: FieldId[]) {
    assertQueryCapabilities(query, context);
    if (fields.length > 8 || fields.some(field => !allowedQueryFields(context.sources).includes(field) || !['enum', 'set', 'boolean'].includes(fieldRegistry[field].type) || ['author', 'openedBy'].includes(field) && !admin(context.sources)))
        throw apiErrors.forbidden('One or more facet fields are unavailable.');
    const evaluationTime = new Date().toISOString(), rows = await matchingRows(query, context, evaluationTime);
    const facets = Object.fromEntries(fields.map(field => {
        const counts = new Map<string, number>();
        for (const row of rows) for (const value of new Set(Array.isArray(row.record.fields[field]) ? row.record.fields[field] as unknown[] : [row.record.fields[field]])) {
            if (value !== undefined && value !== null && value !== '') counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
        }
        if (counts.size > 1000 || [...counts.keys()].some(value => Buffer.byteLength(value) > 2048)) throw new CommentQueryBudgetError();
        return [field, [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count }))];
    }));
    if (Buffer.byteLength(JSON.stringify(facets)) > 1024 * 1024) throw new CommentQueryBudgetError();
    return { version: 1, total: rows.length, evaluationTime, facets };
}
/** Options come from authorized matching rows; no cross-project directory or hidden values. */
export async function queryOptions(query: QueryDocument, context: QueryExecutionContext, field: FieldId, search = '', offset = 0) {
    if (!['enum', 'set'].includes(fieldRegistry[field]?.type) || search.length > 200 || !Number.isSafeInteger(offset) || offset < 0)
        throw apiErrors.invalidRequest('Invalid options request.');
    const result = await queryFacets(query, context, [field]);
    const values = result.facets[field] ?? [];
    const labels = new Map<string, string>([['open', 'Open'], ['in-progress', 'In progress'], ['ready', 'Ready to verify'], ['done', 'Done'],
        ['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low'], ['unknown', 'Source not recorded'], ['removed', 'Removed address']]);
    const workspaces = new Map<string, ReturnType<typeof getWorkspace>>();
    for (const source of context.sources) if (source.project) {
        if (field === 'labels') {
            let workspace = workspaces.get(source.project.workspaceId);
            if (!workspace) {
                workspace = getWorkspace(source.project.workspaceId);
                workspaces.set(source.project.workspaceId, workspace);
            }
            for (const label of effectiveThreadLabels(await workspace, source.project)) labels.set(label.id, label.name);
        }
        if (field === 'project') labels.set(source.project.id, source.project.name);
        if (field === 'environment') for (const option of environmentOptions(source.project)) labels.set(option.id, option.label);
        if (['assignee', 'mentions', 'author', 'openedBy'].includes(field)) for (const [id, name] of await participantNames(source.project)) labels.set(person(id), name);
    }
    const options = values.map(option => ({ ...option, label: labels.get(option.value)
        ?? (['assignee', 'mentions', 'author', 'openedBy'].includes(field) ? option.value.startsWith('user:') ? 'Former member' : 'Guest' : option.value) }))
        .filter(option => `${option.label}\n${option.value}`.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
    return { version: 1, options: options.slice(offset, offset + 100), nextOffset: options.length > offset + 100 ? offset + 100 : null, evaluationTime: result.evaluationTime };
}
export function queryError(error: unknown): Response {
    if (error instanceof QueryValidationError) return Response.json({ error: error.code, issues: error.issues }, { status: 400 });
    if (error instanceof CommentQueryBudgetError || error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
        return Response.json({ error: 'query_too_expensive', message: 'Narrow the query and try again.' }, { status: 422 });
    throw error;
}
