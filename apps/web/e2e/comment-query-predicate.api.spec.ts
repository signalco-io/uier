import { expect, test } from '@playwright/test';
import { evaluateExpression, parseQuery, type Expression, type QueryRecord } from '@uier/comments-query';
import { compileCandidatePredicate } from '../src/lib/commentQuery/predicate';
import type { CommentQueryCandidate } from '../src/lib/repo/commentQuerySource';

const query = (where: Expression) => parseQuery({ version: 1, scope: { kind: 'public' }, where });
const candidate = (changes: Partial<CommentQueryCandidate> = {}): CommentQueryCandidate => ({
    id: 'comment', domain: 'example.test', path: '/a', revision: '1', hasScreenshot: false,
    position: { type: 'page' }, thread: { items: [] }, ...changes
});
const record = (source: CommentQueryCandidate): QueryRecord => ({ id: source.id, scopeKey: source.domain,
    fields: { number: source.number, openedBy: source.authorId, page: source.path,
        status: source.resolved ? 'done' : source.verification?.outcome === 'pending' ? 'ready' : source.inProgress ? 'in-progress' : 'open',
        priority: ['urgent', 'high', 'low'].includes(source.priority ?? '') ? source.priority : 'normal', private: source.private === true }, searchText: '' });

test('native candidate predicates preserve exact actor identity and missing values under negation', () => {
    const input = query({ not: { field: 'openedBy', operator: 'isAnyOf', value: [{ relative: 'me' }] } });
    const compiled = compileCandidatePredicate(input, { viewerId: 'user:Alice' })!;
    expect(compiled.clause).not.toContain('STRINGEQUALS');
    expect(compiled.clause).toContain('IIF(IS_STRING(c.authorId)');
    expect(compiled.parameters).toEqual([{ name: '@q0', value: 'user:Alice' }]);
    expect(compiled.test(candidate({ authorId: 'user:Alice' }))).toBe(false);
    expect(compiled.test(candidate({ authorId: 'user:alice' }))).toBe(true);
    expect(compiled.test(candidate())).toBe(true);
    const nobody = compileCandidatePredicate(input, {})!;
    expect(nobody.parameters).toHaveLength(0);
    expect(nobody.test(candidate())).toBe(true);
});

test('native numeric and defaulted predicates are Boolean for missing properties', () => {
    const expressions: Expression[] = [
        { not: { field: 'number', operator: 'greaterThan', value: 9 } },
        { field: 'number', operator: 'notEquals', value: 10 },
        { field: 'number', operator: 'isEmpty' },
        { field: 'number', operator: 'between', value: [9, 100] },
        { field: 'priority', operator: 'isNoneOf', value: ['urgent'] },
        { field: 'status', operator: 'isAnyOf', value: ['open'] },
        { field: 'private', operator: 'is', value: false },
        { field: 'page', operator: 'isPage', value: '/a' }
    ];
    const samples = [candidate(), candidate({ number: 0 }), candidate({ number: 10 }), candidate({ number: 100 }),
        candidate({ number: 101, resolved: true, priority: 'urgent', private: true }), candidate({ inProgress: true, path: '/A' })];
    for (const expression of expressions) {
        const input = query(expression), compiled = compileCandidatePredicate(input, {})!;
        for (const source of samples) expect(compiled.test(source)).toBe(evaluateExpression(record(source), input.where!));
    }
    expect(compileCandidatePredicate(query(expressions[0]!), {})!.clause).toContain('IIF(IS_NUMBER(c.number)');
    expect(compileCandidatePredicate(query(expressions[2]!), {})!.clause).toContain('IIF(IS_STRING(c.number)');
});

test('residual branches remain conservative through nested All Any and Not', () => {
    const residual: Expression = { field: 'title', operator: 'contains', value: 'interesting' };
    const number: Expression = { field: 'number', operator: 'greaterThan', value: 9 };
    const all = compileCandidatePredicate(query({ all: [number, residual] }), {})!;
    expect(all.test(candidate({ number: 8 }))).toBe(false);
    expect(all.test(candidate({ number: 10 }))).toBe(true);
    const any = compileCandidatePredicate(query({ any: [number, residual] }), {})!;
    expect(any.test(candidate({ number: 8 }))).toBe(true);
    // NOT of an inexact conjunction cannot be narrowed using its exact child.
    expect(compileCandidatePredicate(query({ not: { all: [number, residual] } }), {})).toBeUndefined();
    const nested = compileCandidatePredicate(query({ all: [number, { not: residual }] }), {})!;
    expect(nested.test(candidate({ number: 8 }))).toBe(false);
    expect(nested.test(candidate({ number: 10 }))).toBe(true);
    expect(compileCandidatePredicate(query({ field: 'page', operator: 'equals', value: '/İ' }), {})).toBeUndefined();
    expect(compileCandidatePredicate(query({ not: { field: 'page', operator: 'equals', value: '/İ' } }), {})).toBeUndefined();
});

test('native SQL parameterizes hostile values instead of changing the predicate structure', () => {
    const malicious = '/a\") OR true OR ("';
    const compiled = compileCandidatePredicate(query({ field: 'page', operator: 'isPage', value: malicious }), {})!;
    expect(compiled.clause).not.toContain(malicious);
    expect(compiled.parameters).toEqual([{ name: '@q0', value: malicious }]);
    expect(compiled.test(candidate({ path: malicious }))).toBe(true);
    expect(compiled.test(candidate())).toBe(false);
});

const metadata = (changes: Partial<NonNullable<CommentQueryCandidate['queryMetadata']>> = {}): NonNullable<CommentQueryCandidate['queryMetadata']> => ({
    version: 1, status: 'open', statusRank: 0, priority: 'normal', priorityRank: 2,
    createdMissing: true, updatedMissing: true, completedMissing: true, archivedMissing: true, numberMissing: true,
    assigneeIds: [], authorIds: [], mentionIds: [], agentKinds: [], replyCount: 0, hasScreenshot: false, hasFixLink: false,
    searchText: '', topSequence: 0, secondActorSequence: 0, ...changes
});

test('metadata set pushdowns canonicalize actors and retain legacy rows as conservative candidates', () => {
    const input = query({ all: [
        { field: 'assignee', operator: 'includesAll', value: [{ relative: 'me' }, 'user:Bob'] },
        { field: 'mentions', operator: 'includesNone', value: ['user:Eve'] },
        { field: 'author', operator: 'includesAny', value: ['user:Alice'] },
        { field: 'agents', operator: 'includesAny', value: ['codex'] }
    ] });
    const compiled = compileCandidatePredicate(input, { viewerId: 'user:Alice' })!;
    expect(compiled.clause).toContain('NOT IS_DEFINED(c.queryMetadata.version)');
    expect(compiled.clause).toContain('IS_ARRAY(c.queryMetadata.assigneeIds)');
    expect(compiled.parameters.map(parameter => parameter.value)).toEqual(expect.arrayContaining(['user:Alice', 'Alice', 'user:Bob', 'Bob']));
    expect(compiled.test(candidate())).toBe(true);
    expect(compiled.test(candidate({ queryMetadata: { ...metadata(), version: 2 } as unknown as NonNullable<CommentQueryCandidate['queryMetadata']> }))).toBe(true);
    const matching = metadata({ assigneeIds: ['Alice', 'user:Bob'], authorIds: ['user:Alice'], agentKinds: ['codex'] });
    expect(compiled.test(candidate({ queryMetadata: matching }))).toBe(true);
    expect(compiled.test(candidate({ queryMetadata: { ...matching, assigneeIds: ['alice', 'Bob'] } }))).toBe(false);
    expect(compiled.test(candidate({ queryMetadata: { ...matching, mentionIds: ['Eve'] } }))).toBe(false);
    const negated = query({ not: { field: 'assignee', operator: 'includesAny', value: ['user:Alice'] } });
    expect(compileCandidatePredicate(negated, {})).toBeUndefined();
});

test('metadata numeric and Boolean pushdowns remain inexact even when values exist', () => {
    const input = query({ all: [
        { field: 'replies', operator: 'between', value: [2, 9] },
        { field: 'screenshot', operator: 'is', value: true }
    ] });
    const compiled = compileCandidatePredicate(input, {})!;
    expect(compiled.clause).toContain('IS_NUMBER(c.queryMetadata.replyCount)');
    expect(compiled.clause).toContain('IS_BOOL(c.queryMetadata.hasScreenshot)');
    expect(compiled.test(candidate())).toBe(true);
    expect(compiled.test(candidate({ queryMetadata: metadata({ replyCount: 2, hasScreenshot: true }) }))).toBe(true);
    expect(compiled.test(candidate({ queryMetadata: metadata({ replyCount: 10, hasScreenshot: true }) }))).toBe(false);
    expect(compiled.test(candidate({ queryMetadata: metadata({ replyCount: 2, hasScreenshot: false }) }))).toBe(false);
    expect(compileCandidatePredicate(query({ not: input.where! }), {})).toBeUndefined();
    // Link visibility is audience dependent; raw metadata must never hide a row.
    expect(compileCandidatePredicate(query({ field: 'fixLink', operator: 'is', value: false }), {})).toBeUndefined();
});

test('location selectors push exact pages and separator-aware sections before candidate collection', () => {
    const exact = compileCandidatePredicate(parseQuery({ version: 1, scope: { kind: 'public' }, location: { page: { kind: 'current' } } }), { currentPage: '/a//b' })!;
    expect(exact.clause).toContain('c.path = @q0');
    expect(exact.test(candidate({ path: '/a//b' }))).toBe(true);
    expect(exact.test(candidate({ path: '/a/b' }))).toBe(false);
    const section = compileCandidatePredicate(parseQuery({ version: 1, scope: { kind: 'public' }, location: { page: { kind: 'section', path: '/a' } } }), {})!;
    expect(section.clause).toContain('STARTSWITH');
    for (const path of ['/a', '/a/b', '/a?x=1', '/a#tab']) expect(section.test(candidate({ path }))).toBe(true);
    expect(section.test(candidate({ path: '/another' }))).toBe(false);
});

test('disabled verification status predicates include dormant pending checks in ordinary stages', () => {
    const pending = candidate({ verification: { outcome: 'pending' } });
    const open = query({ field: 'status', operator: 'isAnyOf', value: ['open'] });
    const disabled = compileCandidatePredicate(open, {}, false)!;
    expect(disabled.clause).not.toContain('c.verification');
    expect(disabled.test(pending)).toBe(true);
    expect(disabled.test({ ...pending, inProgress: true })).toBe(false);
    expect(compileCandidatePredicate(open, {}, true)!.test(pending)).toBe(false);
    expect(compileCandidatePredicate(query({ field: 'status', operator: 'isAnyOf', value: ['in-progress'] }), {}, false)!.test({ ...pending, inProgress: true })).toBe(true);
});
