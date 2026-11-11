/** Versioned, storage-independent comment query vocabulary. No authorization lives here. */
export const queryFields = [
    'status', 'priority', 'assignee', 'openedBy', 'author', 'mentions', 'agents', 'project',
    'environment', 'page', 'title', 'text', 'unread', 'private', 'screenshot', 'replies',
    'fixLink', 'created', 'updated', 'completed', 'archived', 'number', 'kind', 'verification',
    'device', 'browser', 'width', 'height'
] as const;
export type FieldId = typeof queryFields[number];
export type FieldType = 'enum' | 'set' | 'string' | 'number' | 'boolean' | 'date';
export const queryOperators = [
    'isAnyOf', 'isNoneOf', 'includesAny', 'includesAll', 'includesNone', 'equals', 'notEquals',
    'contains', 'notContains', 'startsWith', 'endsWith', 'lessThan', 'atMost', 'greaterThan',
    'atLeast', 'between', 'is', 'before', 'after', 'on', 'isEmpty', 'isNotEmpty', 'isPage', 'inSection'
] as const;
export type OperatorId = typeof queryOperators[number];
export type RelativeMe = { relative: 'me' };
export type RelativeDate = { relative: 'today' | 'yesterday' } | { relative: 'lastDays' | 'nextDays'; days: number };
export type QueryAtom = string | number | boolean | RelativeMe;
export type QueryValue = QueryAtom | QueryAtom[] | RelativeDate | { from: string; to: string };
export type Condition = { field: FieldId; operator: OperatorId; value?: QueryValue };
export type Expression = { all: Expression[] } | { any: Expression[] } | { not: Expression } | Condition;
export type QueryScope = { kind: 'project'; projectId: string } | { kind: 'workspace'; workspaceId: string } | { kind: 'public' };
export type PageExpression = { kind: 'current' } | { kind: 'exact' | 'section'; path: string };
export type SortField = Exclude<FieldId, 'assignee' | 'author' | 'mentions' | 'agents' | 'text' | 'unread' | 'private' | 'screenshot' | 'fixLink'>;
export type SortRule = { field: SortField; direction: 'asc' | 'desc' };
export type QueryDocument = {
    version: 1;
    scope: QueryScope;
    collection: 'ordinary' | 'archived';
    location?: { environmentIds?: string[]; page?: PageExpression };
    search?: { mode: 'literal'; text: string };
    where?: Expression;
    order: SortRule[];
    timezone: string;
};
export type QueryRecord = { id: string; scopeKey: string; fields: Partial<Record<FieldId, unknown>>; searchText: string };
export type EvaluationContext = { viewerId?: string; evaluationTime?: string; currentPage?: string; currentEnvironment?: string };
export type QueryIssue = { path: string; message: string };
export class QueryValidationError extends Error {
    readonly code = 'invalid_query';
    readonly issues: QueryIssue[];
    constructor(issues: QueryIssue[]) {
        super(issues[0]?.message ?? 'Invalid query.');
        this.issues = issues;
        this.name = 'QueryValidationError';
    }
}

export const queryLimits = {
    bytes: 64 * 1024, conditions: 100, depth: 8, values: 100, sorts: 8,
    searchCharacters: 1000, searchTerms: 50, valueCharacters: 2000
} as const;
const emptyOperators: readonly OperatorId[] = ['isEmpty', 'isNotEmpty'];
const enumOperators: readonly OperatorId[] = ['isAnyOf', 'isNoneOf', ...emptyOperators];
const setOperators: readonly OperatorId[] = ['includesAny', 'includesAll', 'includesNone', ...emptyOperators];
const stringOperators: readonly OperatorId[] = ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', ...emptyOperators];
const numberOperators: readonly OperatorId[] = ['equals', 'notEquals', 'lessThan', 'atMost', 'greaterThan', 'atLeast', 'between', ...emptyOperators];
const dateOperators: readonly OperatorId[] = ['before', 'after', 'on', 'between', ...emptyOperators];
export type QueryField = {
    type: FieldType;
    operators: readonly OperatorId[];
    sortable: boolean;
    values?: readonly string[];
    /** Named author selection and reproduction fields need a server capability check. */
    restricted?: boolean;
    relativeMe?: boolean;
};
export const fieldRegistry: Readonly<Record<FieldId, QueryField>> = {
    status: { type: 'enum', operators: enumOperators, sortable: true, values: ['open', 'in-progress', 'ready', 'done'] },
    priority: { type: 'enum', operators: enumOperators, sortable: true, values: ['urgent', 'high', 'normal', 'low'] },
    assignee: { type: 'set', operators: setOperators, sortable: false, relativeMe: true },
    openedBy: { type: 'enum', operators: enumOperators, sortable: true, relativeMe: true, restricted: true },
    author: { type: 'set', operators: setOperators, sortable: false, relativeMe: true, restricted: true },
    mentions: { type: 'set', operators: setOperators, sortable: false, relativeMe: true },
    agents: { type: 'set', operators: setOperators, sortable: false },
    project: { type: 'enum', operators: enumOperators, sortable: true },
    environment: { type: 'enum', operators: enumOperators, sortable: true },
    page: { type: 'string', operators: [...stringOperators, 'isPage', 'inSection'], sortable: true },
    title: { type: 'string', operators: stringOperators, sortable: true },
    text: { type: 'string', operators: stringOperators, sortable: false },
    unread: { type: 'boolean', operators: ['is'], sortable: false },
    private: { type: 'boolean', operators: ['is'], sortable: false },
    screenshot: { type: 'boolean', operators: ['is'], sortable: false },
    replies: { type: 'number', operators: numberOperators, sortable: true },
    fixLink: { type: 'boolean', operators: ['is'], sortable: false },
    created: { type: 'date', operators: dateOperators, sortable: true },
    updated: { type: 'date', operators: dateOperators, sortable: true },
    completed: { type: 'date', operators: dateOperators, sortable: true },
    archived: { type: 'date', operators: dateOperators, sortable: true },
    number: { type: 'number', operators: numberOperators, sortable: true },
    kind: { type: 'enum', operators: enumOperators, sortable: true },
    verification: { type: 'enum', operators: enumOperators, sortable: true },
    device: { type: 'enum', operators: enumOperators, sortable: true, restricted: true },
    browser: { type: 'enum', operators: enumOperators, sortable: true, restricted: true },
    width: { type: 'number', operators: numberOperators, sortable: true, restricted: true },
    height: { type: 'number', operators: numberOperators, sortable: true, restricted: true }
};
export const defaultOrder: readonly SortRule[] = [{ field: 'priority', direction: 'asc' }, { field: 'number', direction: 'desc' }];

function fail(path: string, message: string): never {
    throw new QueryValidationError([{ path, message }]);
}
function object(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'Expected an object.');
    return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'Unknown query property.');
}
function string(value: unknown, path: string, max: number = queryLimits.valueCharacters): string {
    if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000]/.test(value)) fail(path, `Expected text of 1–${max} characters.`);
    return value;
}
function id(value: unknown, path: string) {
    const result = string(value, path, 200);
    if (!/^[A-Za-z0-9:_@.\-]+$/.test(result)) fail(path, 'Invalid identifier.');
    return result;
}
function timezone(value: unknown): string {
    const result = value === undefined ? 'UTC' : string(value, 'timezone', 100);
    try { new Intl.DateTimeFormat('en', { timeZone: result }).format(0); }
    catch { fail('timezone', 'Invalid IANA timezone.'); }
    return result;
}
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
export function isDateValue(value: unknown): value is string {
    if (typeof value !== 'string' || (!dateOnly.test(value) && !dateTime.test(value))) return false;
    const day = value.slice(0, 10);
    const parsed = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day) return false;
    return Number.isFinite(Date.parse(value));
}
function date(value: unknown, path: string): string {
    if (!isDateValue(value)) fail(path, 'Expected a valid ISO date or timestamp with an offset.');
    return value;
}
function relativeDate(value: unknown, path: string): RelativeDate {
    const row = object(value, path);
    keys(row, ['relative', 'days'], path);
    if (row.relative === 'today' || row.relative === 'yesterday') {
        if (row.days !== undefined) fail(path, 'This preset does not accept days.');
        return { relative: row.relative };
    }
    if (row.relative !== 'lastDays' && row.relative !== 'nextDays') fail(path, 'Unknown relative date.');
    if (!Number.isSafeInteger(row.days) || Number(row.days) < 1 || Number(row.days) > 3660) fail(`${path}.days`, 'Days must be from 1 to 3660.');
    return { relative: row.relative, days: Number(row.days) };
}
function atom(value: unknown, field: QueryField, path: string): QueryAtom {
    if (field.relativeMe && value && typeof value === 'object' && !Array.isArray(value)) {
        const row = object(value, path); keys(row, ['relative'], path);
        if (row.relative === 'me') return { relative: 'me' };
        fail(path, 'Unknown relative person.');
    }
    const result = string(value, path);
    if (field.values && !field.values.includes(result)) fail(path, 'Unknown field value.');
    return result;
}
function parseCondition(input: Record<string, unknown>, path: string): Condition {
    keys(input, ['field', 'operator', 'value'], path);
    if (typeof input.field !== 'string' || !queryFields.includes(input.field as FieldId)) fail(`${path}.field`, 'Unknown query field.');
    const field = input.field as FieldId, definition = fieldRegistry[field];
    if (typeof input.operator !== 'string' || !definition.operators.includes(input.operator as OperatorId)) fail(`${path}.operator`, 'Operator is not available for this field.');
    const operator = input.operator as OperatorId;
    if (emptyOperators.includes(operator)) {
        if (input.value !== undefined) fail(`${path}.value`, 'Empty-value operators do not accept a value.');
        return { field, operator };
    }
    let value: QueryValue;
    if (operator === 'isAnyOf' || operator === 'isNoneOf' || operator.startsWith('includes')) {
        if (!Array.isArray(input.value) || !input.value.length || input.value.length > queryLimits.values) fail(`${path}.value`, 'Select between 1 and 100 values.');
        value = input.value.map((item, i) => atom(item, definition, `${path}.value.${i}`));
    } else if (definition.type === 'boolean') {
        if (typeof input.value !== 'boolean') fail(`${path}.value`, 'Expected a boolean.');
        value = input.value;
    } else if (definition.type === 'number') {
        const number = (v: unknown, p: string) => {
            if (typeof v !== 'number' || !Number.isFinite(v)) fail(p, 'Expected a finite number.');
            return v;
        };
        if (operator === 'between') {
            if (!Array.isArray(input.value) || input.value.length !== 2) fail(`${path}.value`, 'Expected two numeric bounds.');
            value = input.value.map((v, i) => number(v, `${path}.value.${i}`));
            if (Number(value[0]) > Number(value[1])) fail(`${path}.value`, 'The range start must not exceed its end.');
        } else value = number(input.value, `${path}.value`);
    } else if (definition.type === 'date') {
        if (input.value && typeof input.value === 'object' && !Array.isArray(input.value)) {
            const row = object(input.value, `${path}.value`);
            if ('relative' in row) value = relativeDate(row, `${path}.value`);
            else {
                keys(row, ['from', 'to'], `${path}.value`);
                if (operator !== 'between') fail(`${path}.value`, 'A range requires between.');
                value = { from: date(row.from, `${path}.value.from`), to: date(row.to, `${path}.value.to`) };
            }
        } else {
            if (operator === 'between') {
                if (!Array.isArray(input.value) || input.value.length !== 2) fail(`${path}.value`, 'Expected two date bounds.');
                value = { from: date(input.value[0], `${path}.value.0`), to: date(input.value[1], `${path}.value.1`) };
            } else value = date(input.value, `${path}.value`);
        }
    } else {
        value = string(input.value, `${path}.value`);
        if ((operator === 'isPage' || operator === 'inSection') && !value.startsWith('/')) fail(`${path}.value`, 'Expected a canonical page path.');
    }
    return { field, operator, value };
}
function parseExpression(input: unknown, path: string, depth: number, state: { leaves: number }): Expression {
    if (depth > queryLimits.depth) fail(path, 'Use at most eight group levels.');
    const row = object(input, path);
    if ('all' in row || 'any' in row) {
        const connector = 'all' in row ? 'all' : 'any';
        keys(row, [connector], path);
        const children = row[connector];
        if (!Array.isArray(children) || !children.length || children.length > queryLimits.conditions) fail(path, 'A group requires 1–100 conditions.');
        return { [connector]: children.map((child, i) => parseExpression(child, `${path}.${connector}.${i}`, depth + 1, state)) } as Expression;
    }
    if ('not' in row) {
        keys(row, ['not'], path);
        return { not: parseExpression(row.not, `${path}.not`, depth + 1, state) };
    }
    state.leaves++;
    if (state.leaves > queryLimits.conditions) fail(path, 'Use at most 100 conditions.');
    return parseCondition(row, path);
}

/** Validates untrusted input. The returned document is canonical; unsupported data is never dropped. */
export function parseQuery(input: unknown): QueryDocument {
    let serialized: string;
    try { serialized = typeof input === 'string' ? input : JSON.stringify(input); }
    catch { fail('', 'Query must be JSON serializable.'); }
    if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > queryLimits.bytes) fail('', 'Query exceeds 64 KiB.');
    if (typeof input === 'string') {
        try { input = JSON.parse(input); } catch { fail('', 'Invalid query JSON.'); }
    }
    const row = object(input, 'query');
    keys(row, ['version', 'scope', 'collection', 'location', 'search', 'where', 'order', 'timezone'], 'query');
    if (row.version !== 1) fail('version', 'Unsupported query version.');
    const scope = object(row.scope, 'scope');
    let parsedScope: QueryScope;
    if (scope.kind === 'project') { keys(scope, ['kind', 'projectId'], 'scope'); parsedScope = { kind: 'project', projectId: id(scope.projectId, 'scope.projectId') }; }
    else if (scope.kind === 'workspace') { keys(scope, ['kind', 'workspaceId'], 'scope'); parsedScope = { kind: 'workspace', workspaceId: id(scope.workspaceId, 'scope.workspaceId') }; }
    else if (scope.kind === 'public') { keys(scope, ['kind'], 'scope'); parsedScope = { kind: 'public' }; }
    else fail('scope.kind', 'Unknown query scope.');
    const collection = row.collection ?? 'ordinary';
    if (collection !== 'ordinary' && collection !== 'archived') fail('collection', 'Unknown comment collection.');
    const query: QueryDocument = { version: 1, scope: parsedScope, collection, order: [], timezone: timezone(row.timezone) };
    if (row.location !== undefined) {
        const location = object(row.location, 'location'); keys(location, ['environmentIds', 'page'], 'location');
        query.location = {};
        if (location.environmentIds !== undefined) {
            if (!Array.isArray(location.environmentIds) || !location.environmentIds.length || location.environmentIds.length > queryLimits.values) fail('location.environmentIds', 'Select between 1 and 100 environments.');
            query.location.environmentIds = location.environmentIds.map((v, i) => id(v, `location.environmentIds.${i}`));
        }
        if (location.page !== undefined) {
            const page = object(location.page, 'location.page');
            if (page.kind === 'current') { keys(page, ['kind'], 'location.page'); query.location.page = { kind: 'current' }; }
            else if (page.kind === 'exact' || page.kind === 'section') {
                keys(page, ['kind', 'path'], 'location.page');
                const path = string(page.path, 'location.page.path');
                if (!path.startsWith('/')) fail('location.page.path', 'Expected a canonical page path.');
                query.location.page = { kind: page.kind, path };
            } else fail('location.page.kind', 'Unknown page selector.');
        }
    }
    if (row.search !== undefined) {
        const search = object(row.search, 'search'); keys(search, ['mode', 'text'], 'search');
        if (search.mode !== 'literal' || typeof search.text !== 'string' || search.text.length > queryLimits.searchCharacters || search.text.includes('\0')) fail('search', 'Expected literal search of at most 1,000 characters.');
        if (search.text.trim().split(/\s+/).filter(Boolean).length > queryLimits.searchTerms) fail('search.text', 'Use at most 50 search terms.');
        query.search = { mode: 'literal', text: search.text };
    }
    if (row.where !== undefined) query.where = parseExpression(row.where, 'where', 0, { leaves: 0 });
    const orders = row.order === undefined ? defaultOrder : row.order;
    if (!Array.isArray(orders) || orders.length > queryLimits.sorts) fail('order', 'Use at most eight sort rules.');
    const sorts = new Set<string>();
    query.order = orders.map((raw, i) => {
        const sort = object(raw, `order.${i}`); keys(sort, ['field', 'direction'], `order.${i}`);
        if (typeof sort.field !== 'string' || !queryFields.includes(sort.field as FieldId) || !fieldRegistry[sort.field as FieldId].sortable) fail(`order.${i}.field`, 'Field is not sortable.');
        if (sorts.has(sort.field)) fail(`order.${i}.field`, 'A field can only be sorted once.');
        sorts.add(sort.field);
        if (sort.direction !== 'asc' && sort.direction !== 'desc') fail(`order.${i}.direction`, 'Unknown sort direction.');
        return { field: sort.field as SortField, direction: sort.direction };
    });
    // Validate date ranges after the timezone is available, including DST-aware date-only bounds.
    visitConditions(query.where, condition => {
        if (fieldRegistry[condition.field].type !== 'date' || condition.operator !== 'between' || !condition.value || typeof condition.value !== 'object' || Array.isArray(condition.value) || !('from' in condition.value)) return;
        const from = dateInstant(condition.value.from, query.timezone), to = dateInstant(condition.value.to, query.timezone);
        if (from >= to) fail('where.value', 'The date range start must precede its end.');
    });
    return normalizeQuery(query);
}

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function normalizeExpression(expression: Expression): Expression {
    if ('all' in expression || 'any' in expression) {
        const connector = 'all' in expression ? 'all' : 'any';
        const children = ('all' in expression ? expression.all : expression.any).map(normalizeExpression);
        const unique = new Map(children.map(child => [stable(child), child]));
        return { [connector]: [...unique.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value) } as Expression;
    }
    if ('not' in expression) return { not: normalizeExpression(expression.not) };
    const value = expression.value;
    if (Array.isArray(value) && (expression.operator === 'isAnyOf' || expression.operator === 'isNoneOf' || expression.operator.startsWith('includes'))) {
        return { ...expression, value: [...new Map(value.map(item => [stable(item), item])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => item) };
    }
    return { ...expression };
}
/** Deterministic without changing Boolean grouping or literal search semantics. */
export function normalizeQuery(query: QueryDocument): QueryDocument {
    return {
        version: 1, scope: { ...query.scope }, collection: query.collection,
        ...(query.location && (query.location.page || query.location.environmentIds?.length) ? { location: {
            ...(query.location.environmentIds?.length ? { environmentIds: [...new Set(query.location.environmentIds)].sort() } : {}),
            ...(query.location.page ? { page: { ...query.location.page } } : {})
        } } : {}),
        ...(query.search?.text.trim() ? { search: { mode: 'literal' as const, text: query.search.text.trim() } } : {}),
        ...(query.where ? { where: normalizeExpression(query.where) } : {}),
        order: query.order.map(sort => ({ ...sort })), timezone: query.timezone
    };
}
export function serializeQuery(query: QueryDocument): string { return stable(normalizeQuery(query)); }
export function visitConditions(expression: Expression | undefined, visit: (condition: Condition) => void): void {
    if (!expression) return;
    if ('all' in expression) { expression.all.forEach(child => visitConditions(child, visit)); return; }
    if ('any' in expression) { expression.any.forEach(child => visitConditions(child, visit)); return; }
    if ('not' in expression) { visitConditions(expression.not, visit); return; }
    visit(expression);
}

type CalendarDate = { year: number; month: number; day: number };
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
function calendarDate(instant: number, zone: string): CalendarDate {
    let formatter = dateFormatters.get(zone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', era: 'short' });
        // Bound this pure helper's optional formatter cache in a long-running process.
        if (dateFormatters.size >= 32) dateFormatters.delete(dateFormatters.keys().next().value!);
        dateFormatters.set(zone, formatter);
    }
    const parts = formatter.formatToParts(instant);
    const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
    const year = value('year');
    return { year: parts.find(part => part.type === 'era')?.value === 'BC' ? 1 - year : year, month: value('month'), day: value('day') };
}
const ordinal = (day: CalendarDate) => {
    const instant = new Date(0);
    instant.setUTCFullYear(day.year, day.month - 1, day.day);
    instant.setUTCHours(0, 0, 0, 0);
    return instant.getTime();
};
function addDays(day: CalendarDate, count: number): CalendarDate {
    const date = new Date(ordinal(day) + count * 86_400_000);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
/** The first instant in the local calendar date, also correct across DST and midnight gaps. */
export function startOfDay(day: string | CalendarDate, zone: string): number {
    const target = typeof day === 'string'
        ? { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)) }
        : day;
    const targetOrdinal = ordinal(target);
    let low = targetOrdinal - 2 * 86_400_000, high = targetOrdinal + 2 * 86_400_000;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (ordinal(calendarDate(middle, zone)) < targetOrdinal) low = middle + 1;
        else high = middle;
    }
    return low;
}
export function dateInstant(value: string, zone = 'UTC'): number {
    return dateOnly.test(value) ? startOfDay(value, zone) : Date.parse(value);
}
export function resolveDateRange(value: string | RelativeDate | { from: string; to: string }, zone: string, evaluationTime: string): { from: number; to: number } {
    if (typeof value === 'string') {
        const from = dateInstant(value, zone);
        if (!dateOnly.test(value)) return { from, to: from + 1 };
        const day = { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) };
        return { from, to: startOfDay(addDays(day, 1), zone) };
    }
    if ('from' in value) return { from: dateInstant(value.from, zone), to: dateInstant(value.to, zone) };
    const now = Date.parse(evaluationTime);
    if (!Number.isFinite(now)) throw new QueryValidationError([{ path: 'evaluationTime', message: 'A valid evaluation time is required.' }]);
    const today = calendarDate(now, zone);
    let first = today, end = addDays(today, 1);
    if (value.relative === 'yesterday') { first = addDays(today, -1); end = today; }
    if (value.relative === 'lastDays') first = addDays(today, 1 - value.days);
    if (value.relative === 'nextDays') { first = addDays(today, 1); end = addDays(first, value.days); }
    return { from: startOfDay(first, zone), to: startOfDay(end, zone) };
}

export function isEmptyValue(value: unknown): boolean {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}
function person(value: unknown, context: EvaluationContext): unknown {
    return value && typeof value === 'object' && !Array.isArray(value) && 'relative' in value && value.relative === 'me' ? context.viewerId : value;
}
function same(a: unknown, b: unknown): boolean {
    return a === b;
}
/** Section matching is separator-aware and deliberately preserves repeated slashes. */
export function inPageSection(base: string, path: string): boolean {
    return path === base || path.startsWith(base === '/' ? '/' : `${base}/`) || path.startsWith(`${base}?`) || path.startsWith(`${base}#`);
}
export function evaluateCondition(record: QueryRecord, condition: Condition, context: EvaluationContext = {}, zone = 'UTC'): boolean {
    const actual = record.fields[condition.field], empty = isEmptyValue(actual), op = condition.operator;
    if (op === 'isEmpty') return empty;
    if (op === 'isNotEmpty') return !empty;
    const expected = person(condition.value, context);
    if (op === 'isAnyOf' || op === 'isNoneOf' || op.startsWith('includes')) {
        const requested = (Array.isArray(condition.value) ? condition.value : []).map(value => person(value, context));
        const actualValues = Array.isArray(actual) ? actual : empty ? [] : [actual];
        const contains = (value: unknown) => value !== undefined && actualValues.some(item => same(item, value));
        const any = requested.some(contains);
        if (op === 'includesAll') return requested.every(contains);
        return op === 'isNoneOf' || op === 'includesNone' ? !any : any;
    }
    if (op === 'is') return typeof actual === 'boolean' && actual === expected;
    if (op === 'equals' || op === 'notEquals') {
        const equal = !empty && (fieldRegistry[condition.field].type === 'string' && typeof actual === 'string' && typeof expected === 'string'
            ? actual.toLowerCase() === expected.toLowerCase() : same(actual, expected));
        return op === 'notEquals' ? !equal : equal;
    }
    if (op === 'contains' || op === 'notContains' || op === 'startsWith' || op === 'endsWith') {
        const text = typeof actual === 'string' ? actual.toLowerCase() : '';
        const term = typeof expected === 'string' ? expected.toLowerCase() : '';
        const match = !empty && (op === 'startsWith' ? text.startsWith(term) : op === 'endsWith' ? text.endsWith(term) : text.includes(term));
        return op === 'notContains' ? !match : match;
    }
    if (op === 'isPage' || op === 'inSection') return typeof actual === 'string' && typeof expected === 'string'
        && (op === 'isPage' ? actual === expected : inPageSection(expected, actual));
    if (fieldRegistry[condition.field].type === 'date') {
        if (typeof actual !== 'string' && typeof actual !== 'number') return false;
        const instant = typeof actual === 'number' ? actual : Date.parse(actual);
        if (!Number.isFinite(instant)) return false;
        const range = resolveDateRange(condition.value as string | RelativeDate | { from: string; to: string }, zone, context.evaluationTime ?? new Date().toISOString());
        if (op === 'before') return instant < range.from;
        if (op === 'after') return instant >= (typeof condition.value === 'string' && !dateOnly.test(condition.value) ? range.from + 1 : range.to);
        return instant >= range.from && instant < range.to;
    }
    if (typeof actual !== 'number' || !Number.isFinite(actual)) return false;
    if (op === 'between') return Array.isArray(condition.value) && actual >= Number(condition.value[0]) && actual <= Number(condition.value[1]);
    if (typeof expected !== 'number') return false;
    if (op === 'lessThan') return actual < expected;
    if (op === 'atMost') return actual <= expected;
    if (op === 'greaterThan') return actual > expected;
    if (op === 'atLeast') return actual >= expected;
    return false;
}
export function evaluateExpression(record: QueryRecord, expression: Expression, context: EvaluationContext = {}, zone = 'UTC'): boolean {
    if ('all' in expression) return expression.all.every(child => evaluateExpression(record, child, context, zone));
    if ('any' in expression) return expression.any.some(child => evaluateExpression(record, child, context, zone));
    if ('not' in expression) return !evaluateExpression(record, expression.not, context, zone);
    return evaluateCondition(record, expression, context, zone);
}
export function evaluateQuery(record: QueryRecord, query: QueryDocument, context: EvaluationContext = {}): boolean {
    if ((query.collection === 'archived') !== !isEmptyValue(record.fields.archived)) return false;
    if (query.scope.kind === 'project' && record.fields.project !== query.scope.projectId) return false;
    const environment = record.fields.environment;
    if (query.location?.environmentIds?.length && !query.location.environmentIds.some(id => same(environment, id === 'current' ? context.currentEnvironment : id))) return false;
    const page = query.location?.page;
    if (page) {
        const target = page.kind === 'current' ? context.currentPage : page.path;
        if (typeof target !== 'string' || typeof record.fields.page !== 'string') return false;
        if (page.kind === 'section' ? !inPageSection(target, record.fields.page) : record.fields.page !== target) return false;
    }
    const text = record.searchText.toLowerCase();
    if (query.search?.text.toLowerCase().split(/\s+/).filter(Boolean).some(term => !text.includes(term))) return false;
    return !query.where || evaluateExpression(record, query.where, context, query.timezone);
}

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const statusRank: Record<string, number> = { open: 0, 'in-progress': 1, ready: 2, done: 3 };
function sortValue(record: QueryRecord, field: SortField): string | number | boolean | undefined {
    const value = record.fields[field];
    if (isEmptyValue(value)) return undefined;
    if (field === 'priority') return typeof value === 'string' ? priorityRank[value] : undefined;
    if (field === 'status') return typeof value === 'string' ? statusRank[value] : undefined;
    if (fieldRegistry[field].type === 'date') {
        const number = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
        return Number.isFinite(number) ? number : undefined;
    }
    if (typeof value === 'string') return value.toLowerCase();
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    return typeof value === 'boolean' ? value : undefined;
}
export function compareQueryRecords(a: QueryRecord, b: QueryRecord, order: readonly SortRule[]): number {
    for (const sort of order) {
        const av = sortValue(a, sort.field), bv = sortValue(b, sort.field);
        if (av === undefined || bv === undefined) {
            if (av !== bv) return av === undefined ? 1 : -1;
            continue;
        }
        const comparison = av < bv ? -1 : av > bv ? 1 : 0;
        if (comparison) return sort.direction === 'desc' ? -comparison : comparison;
    }
    return a.scopeKey < b.scopeKey ? -1 : a.scopeKey > b.scopeKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Data-only capability projection. Server authorization must choose the allowed field IDs. */
export function queryCapabilities(fields: readonly FieldId[] = queryFields) {
    return { version: 1 as const, limits: queryLimits,
        fields: fields.map(id => ({ id, ...fieldRegistry[id] })) };
}
