import { expect, test } from '@playwright/test';
import {
    compareQueryRecords, evaluateQuery, parseQuery, QueryValidationError, resolveDateRange,
    serializeQuery, type QueryDocument, type QueryRecord
} from '@uier/comments-query';

const base = (extra: Partial<QueryDocument> = {}): QueryDocument => ({ version: 1,
    scope: { kind: 'project', projectId: 'project-test' }, collection: 'ordinary',
    order: [{ field: 'priority', direction: 'asc' }, { field: 'created', direction: 'desc' }],
    timezone: 'Europe/Zagreb', ...extra });
const record = (id: string, fields: QueryRecord['fields'] = {}, searchText = ''): QueryRecord => ({
    id, scopeKey: 'project:project-test', fields: { project: 'project-test', priority: 'normal', ...fields }, searchText
});

test('nested All/Any/Not and array predicates retain their meaning with missing values', () => {
    const query = parseQuery(base({ where: { all: [
        { field: 'status', operator: 'isAnyOf', value: ['open', 'in-progress'] },
        { any: [
            { field: 'priority', operator: 'isAnyOf', value: ['urgent'] },
            { all: [{ field: 'assignee', operator: 'includesAll', value: [{ relative: 'me' }, 'second'] },
                { not: { field: 'unread', operator: 'is', value: false } }] }
        ] }
    ] } }));
    const context = { viewerId: 'first' };
    expect(evaluateQuery(record('a', { status: 'open', assignee: ['first', 'second'], unread: true }), query, context)).toBe(true);
    expect(evaluateQuery(record('b', { status: 'open', assignee: ['first'], unread: true }), query, context)).toBe(false);
    expect(evaluateQuery(record('c', { status: 'done', priority: 'urgent' }), query, context)).toBe(false);
    expect(evaluateQuery(record('d', { status: 'open', priority: 'urgent' }), query, context)).toBe(true);
    const none = parseQuery(base({ where: { field: 'assignee', operator: 'includesNone', value: ['first'] } }));
    expect(evaluateQuery(record('unassigned'), none)).toBe(true);
    expect(evaluateQuery(record('assigned', { assignee: ['first'] }), none)).toBe(false);
});

test('literal terms, punctuation and exact/section pages are not fuzzy or substring aliases', () => {
    const query = parseQuery(base({ search: { mode: 'literal', text: ' PRICING 100% _test ' },
        location: { page: { kind: 'section', path: '/a//b' } } }));
    expect(evaluateQuery(record('a', { page: '/a//b/c' }, '100% pricing literal _test'), query)).toBe(true);
    expect(evaluateQuery(record('b', { page: '/a/b/c' }, '100% pricing literal _test'), query)).toBe(false);
    expect(evaluateQuery(record('c', { page: '/a//blog' }, '100% pricing literal _test'), query)).toBe(false);
    expect(evaluateQuery(record('d', { page: '/a//b/c' }, 'pricing 1000 and test'), query)).toBe(false);
    const contains = parseQuery(base({ where: { field: 'text', operator: 'contains', value: 'one two' } }));
    expect(evaluateQuery(record('phrase', { text: 'one two' }), contains)).toBe(true);
    expect(evaluateQuery(record('words', { text: 'one and two' }), contains)).toBe(false);
});

test('numeric ranges are numeric; negative conditions deliberately include missing values', () => {
    const query = parseQuery(base({ where: { all: [
        { field: 'number', operator: 'between', value: [9, 100] },
        { field: 'title', operator: 'notContains', value: 'secret' }
    ] } }));
    expect(evaluateQuery(record('a', { number: 99 }), query)).toBe(true);
    expect(evaluateQuery(record('b', { number: 101 }), query)).toBe(false);
    expect(evaluateQuery(record('c', { number: 10, title: 'A SECRET' }), query)).toBe(false);
    const notEmpty = parseQuery(base({ where: { field: 'title', operator: 'isNotEmpty' } }));
    expect(evaluateQuery(record('missing'), notEmpty)).toBe(false);
});

test('IANA calendar days and relative ranges use pinned evaluation time across DST', () => {
    const spring = resolveDateRange('2026-03-29', 'Europe/Zagreb', '2026-03-29T12:00:00Z');
    expect(new Date(spring.from).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(new Date(spring.to).toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(spring.to - spring.from).toBe(23 * 3600_000);
    const autumn = resolveDateRange('2026-10-25', 'Europe/Zagreb', '2026-10-25T12:00:00Z');
    expect(autumn.to - autumn.from).toBe(25 * 3600_000);
    const today = parseQuery(base({ where: { field: 'created', operator: 'on', value: { relative: 'today' } } }));
    const context = { evaluationTime: '2026-03-29T12:00:00Z' };
    expect(evaluateQuery(record('included', { created: '2026-03-29T21:59:59Z' }), today, context)).toBe(true);
    expect(evaluateQuery(record('excluded', { created: '2026-03-29T22:00:00Z' }), today, context)).toBe(false);
    const lastTwo = resolveDateRange({ relative: 'lastDays', days: 2 }, 'Europe/Zagreb', '2026-03-29T12:00:00Z');
    expect(new Date(lastTwo.from).toISOString()).toBe('2026-03-27T23:00:00.000Z');
    expect(lastTwo.to).toBe(spring.to);
});

test('mixed direction sorts keep missing values last and use deterministic scope/id ties', () => {
    const rows = [
        record('low', { priority: 'low', created: '2026-10-01' }),
        record('missing', { priority: 'urgent' }),
        record('older', { priority: 'urgent', created: '2026-09-01' }),
        record('newer-b', { priority: 'urgent', created: '2026-10-01' }),
        record('newer-a', { priority: 'urgent', created: '2026-10-01' })
    ];
    expect([...rows].sort((a, b) => compareQueryRecords(a, b, base().order)).map(row => row.id))
        .toEqual(['newer-a', 'newer-b', 'older', 'missing', 'low']);
    const numeric = [record('100', { number: 100 }), record('9', { number: 9 }), record('none')];
    expect(numeric.sort((a, b) => compareQueryRecords(a, b, [{ field: 'number', direction: 'asc' }])).map(row => row.id)).toEqual(['9', '100', 'none']);
});

test('normalization deduplicates alternatives without flattening Boolean groups or changing query identity', () => {
    const a = parseQuery(base({ where: { all: [
        { field: 'priority', operator: 'isAnyOf', value: ['urgent', 'high', 'urgent'] },
        { any: [{ field: 'unread', operator: 'is', value: true }, { field: 'private', operator: 'is', value: false }] }
    ] } }));
    const b = parseQuery(base({ where: { all: [
        { any: [{ field: 'private', operator: 'is', value: false }, { field: 'unread', operator: 'is', value: true }] },
        { field: 'priority', operator: 'isAnyOf', value: ['high', 'urgent'] }
    ] } }));
    expect(serializeQuery(a)).toBe(serializeQuery(b));
    expect(JSON.stringify(a.where)).toContain('"any"');
});

test('schema rejects invalid types, unknown properties, fields/operators, duplicates and resource abuse', () => {
    const invalid: unknown[] = [
        { ...base(), role: 'admin' },
        base({ timezone: 'Made/Up' }),
        base({ where: { field: 'private', operator: 'is', value: 'false' } }),
        base({ where: { field: 'priority', operator: 'contains', value: 'urgent' } }),
        base({ where: { field: 'priority', operator: 'isAnyOf', value: [] } }),
        base({ where: { field: 'number', operator: 'between', value: [100, 1] } }),
        base({ where: { field: 'created', operator: 'on', value: '2026-02-30' } }),
        base({ where: { field: 'created', operator: 'on', value: '2026-01-01T12:00:00' } }),
        base({ order: [{ field: 'number', direction: 'asc' }, { field: 'number', direction: 'desc' }] }),
        base({ where: { all: [] } }),
        base({ search: { mode: 'literal', text: 'x'.repeat(1001) } }),
        base({ where: { all: Array.from({ length: 101 }, () => ({ field: 'unread', operator: 'is', value: true })) } }),
        base({ where: { field: 'assignee', operator: 'includesAny', value: Array.from({ length: 101 }, (_, i) => `person-${i}`) } })
    ];
    let nested: unknown = { field: 'unread', operator: 'is', value: true };
    for (let i = 0; i < 10; i++) nested = { not: nested };
    invalid.push({ ...base(), where: nested });
    for (const input of invalid) expect(() => parseQuery(input)).toThrow(QueryValidationError);
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => parseQuery(cyclic)).toThrow(QueryValidationError);
    const huge = JSON.stringify({ ...base(), ignored: 'é'.repeat(40_000) });
    expect(() => parseQuery(huge)).toThrow('64 KiB');
});

test('Archive is independent of ordinary status expressions and project scope is checked', () => {
    expect(evaluateQuery(record('archived', { archived: '2026-01-01', status: 'open' }), base())).toBe(false);
    expect(evaluateQuery(record('archived', { archived: '2026-01-01', status: 'open' }), base({ collection: 'archived' }))).toBe(true);
    expect(evaluateQuery(record('other', { project: 'other' }), base())).toBe(false);
});


test('text equality folds case while environment selectors preserve real configured IDs', () => {
    const query = parseQuery(base({ location: { environmentIds: ['origin:https://app.example', 'group:Live sites'] },
        where: { field: 'title', operator: 'equals', value: 'checkout' } }));
    expect(evaluateQuery(record('match', { environment: 'origin:https://app.example', title: 'Checkout' }), query)).toBe(true);
    expect(evaluateQuery(record('different-environment', { environment: 'origin:https://other.example', title: 'Checkout' }), query)).toBe(false);
    const notEqual = parseQuery(base({ where: { field: 'text', operator: 'notEquals', value: 'checkout' } }));
    expect(evaluateQuery(record('case', { text: 'Checkout' }), notEqual)).toBe(false);
});
