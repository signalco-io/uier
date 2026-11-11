import type { SqlParameter } from '@azure/cosmos';
import { evaluateExpression, type Condition, type EvaluationContext, type Expression, type QueryDocument, type QueryRecord } from '@uier/comments-query';
import type { CommentCandidatePredicate, CommentQueryCandidate } from '../repo/commentQuerySource';

type Compiled = { sql: string; exact: boolean; test: (record: QueryRecord, candidate: CommentQueryCandidate) => boolean };
const residual: Compiled = { sql: 'true', exact: false, test: () => true };

/** Every emitted expression is Boolean, including for missing Cosmos properties under NOT. */
export function compileCandidatePredicate(query: QueryDocument, context: EvaluationContext): CommentCandidatePredicate | undefined {
    const parameters: SqlParameter[] = [];
    const param = (value: SqlParameter['value']) => { const name = `@q${parameters.length}`; parameters.push({ name, value }); return name; };
    const resolve = (input: unknown) => input && typeof input === 'object' && 'relative' in input ? context.viewerId : input;
    const leaf = (condition: Condition): string | undefined => {
        const scalar: Partial<Record<Condition['field'], string>> = {
            page: 'c.path', number: 'c.number', openedBy: 'c.authorId',
            private: 'IIF(c.private = true, true, false)',
            status: 'IIF(c.resolved = true, "done", IIF(c.verification.outcome = "pending", "ready", IIF(c.inProgress = true, "in-progress", "open")))',
            priority: 'IIF(c.priority IN ("urgent", "high", "low"), c.priority, "normal")'
        };
        const column = scalar[condition.field];
        if (!column) return undefined;
        const value = condition.value;
        // Cosmos cross-type equality can produce undefined. Do not compare numbers to "".
        const present = `IIF(IS_DEFINED(${column}), IIF(IS_STRING(${column}), ${column} != "", NOT IS_NULL(${column})), false)`;
        switch (condition.operator) {
            case 'isEmpty': return `(NOT ${present})`;
            case 'isNotEmpty': return present;
            case 'is': return `(${column} = ${param(value as boolean)})`;
            case 'isAnyOf': case 'isNoneOf': {
                const choices = (value as unknown[]).map(resolve).filter((v): v is string => typeof v === 'string');
                // Enum and actor IDs use exact identity. Case folding is unsafe under negation.
                const sql = choices.length ? `(${choices.map(v => `${column} = ${param(v)}`).join(' OR ')})` : 'false';
                const match = `IIF(IS_STRING(${column}), ${sql}, false)`;
                return condition.operator === 'isNoneOf' ? `(NOT ${match})` : match;
            }
            case 'equals': case 'notEquals': {
                // Text equality uses JS Unicode lowercasing; leave it residual rather than
                // assume Cosmos STRINGEQUALS has precisely the same Unicode semantics.
                if (typeof value !== 'number') return undefined;
                const match = `IIF(IS_NUMBER(${column}), ${column} = ${param(value)}, false)`;
                return condition.operator === 'notEquals' ? `(NOT ${match})` : match;
            }
            case 'lessThan': case 'atMost': case 'greaterThan': case 'atLeast':
                return `IIF(IS_NUMBER(${column}), ${column} ${{ lessThan: '<', atMost: '<=', greaterThan: '>', atLeast: '>=' }[condition.operator]} ${param(value as number)}, false)`;
            case 'between': return `IIF(IS_NUMBER(${column}), ${column} >= ${param((value as [number, number])[0])} AND ${column} <= ${param((value as [number, number])[1])}, false)`;
            case 'isPage': return `IIF(IS_STRING(${column}), ${column} = ${param(value as string)}, false)`;
            // Unicode text matching and separator-aware paths remain residual.
            default: return undefined;
        }
    };
    const metadataLeaf = (condition: Condition): Compiled | undefined => {
        // Fix links depend on audience/environment visibility and stay in the service.
        const properties = { assignee: 'assigneeIds', author: 'authorIds', mentions: 'mentionIds', agents: 'agentKinds',
            replies: 'replyCount', screenshot: 'hasScreenshot' } as const;
        const property = properties[condition.field as keyof typeof properties];
        if (!property) return undefined;
        const column = `c.queryMetadata.${property}`;
        let sql: string, valid: string;
        if (['assignee', 'author', 'mentions', 'agents'].includes(condition.field)) {
            valid = `IS_ARRAY(${column})`;
            if (condition.operator === 'isEmpty' || condition.operator === 'isNotEmpty') {
                sql = `ARRAY_LENGTH(${column}) ${condition.operator === 'isEmpty' ? '=' : '>'} 0`;
            } else if (['includesAny', 'includesAll', 'includesNone'].includes(condition.operator)) {
                const choices = (condition.value as unknown[]).map(resolve);
                const membership = choices.map(value => {
                    if (typeof value !== 'string') return 'false';
                    // Canonical query actors have user: prefixes; old source IDs may already
                    // carry one or may be bare. Both source forms normalize to the same actor.
                    if (condition.field === 'assignee' || condition.field === 'mentions') {
                        if (!value.startsWith('user:')) return 'false';
                        return `(ARRAY_CONTAINS(${column}, ${param(value)}) OR ARRAY_CONTAINS(${column}, ${param(value.slice(5))}))`;
                    }
                    return `ARRAY_CONTAINS(${column}, ${param(value)})`;
                });
                sql = `(${membership.join(condition.operator === 'includesAll' ? ' AND ' : ' OR ')})`;
                if (condition.operator === 'includesNone') sql = `(NOT ${sql})`;
            } else return undefined;
        } else if (condition.field === 'replies') {
            valid = `IS_NUMBER(${column})`;
            const value = condition.value as number;
            switch (condition.operator) {
                case 'equals': case 'notEquals': sql = `${column} ${condition.operator === 'equals' ? '=' : '!='} ${param(value)}`; break;
                case 'lessThan': case 'atMost': case 'greaterThan': case 'atLeast':
                    sql = `${column} ${{ lessThan: '<', atMost: '<=', greaterThan: '>', atLeast: '>=' }[condition.operator]} ${param(value)}`; break;
                case 'between': sql = `(${column} >= ${param((condition.value as [number, number])[0])} AND ${column} <= ${param((condition.value as [number, number])[1])})`; break;
                // This projected count is always materialized on version 1 metadata.
                case 'isEmpty': sql = 'false'; break;
                case 'isNotEmpty': sql = 'true'; break;
                default: return undefined;
            }
        } else {
            if (condition.operator !== 'is') return undefined;
            valid = `IS_BOOL(${column})`;
            sql = `${column} = ${param(condition.value as boolean)}`;
        }
        // Metadata is an optimization only. Legacy records and unrecognized/corrupt values
        // must continue to the full source evaluator. This entire leaf is therefore inexact.
        return { sql: `(NOT IS_DEFINED(c.queryMetadata.version) OR IIF(IS_NUMBER(c.queryMetadata.version), c.queryMetadata.version != 1, true) OR IIF(${valid}, (${sql}), true))`,
            exact: false, test: (record, candidate) => {
                const metadata = candidate.queryMetadata;
                if (!metadata || metadata.version !== 1) return true;
                const raw = metadata[property];
                const sets = ['assignee', 'author', 'mentions', 'agents'].includes(condition.field);
                if (sets ? !Array.isArray(raw) : condition.field === 'replies' ? typeof raw !== 'number' : typeof raw !== 'boolean') return true;
                const value = (condition.field === 'assignee' || condition.field === 'mentions') && Array.isArray(raw)
                    ? raw.map(id => typeof id === 'string' && !id.startsWith('user:') ? `user:${id}` : id) : raw;
                return evaluateExpression({ ...record, fields: { [condition.field]: value } }, condition, context, query.timezone);
            } };
    };
    const compile = (expression: Expression): Compiled => {
        if ('not' in expression) {
            const child = compile(expression.not);
            // Negating a superset would discard real matches. Only negate exact native work.
            return child.exact ? { sql: `(NOT (${child.sql}))`, exact: true, test: (record, candidate) => !child.test(record, candidate) } : residual;
        }
        if ('all' in expression || 'any' in expression) {
            const all = 'all' in expression;
            const children = (all ? expression.all : expression.any).map(compile);
            return { sql: children.length ? `(${children.map(c => c.sql).join(all ? ' AND ' : ' OR ')})` : all ? 'true' : 'false',
                exact: children.every(c => c.exact), test: (record, candidate) => all ? children.every(child => child.test(record, candidate)) : children.some(child => child.test(record, candidate)) };
        }
        const sql = leaf(expression);
        return sql === undefined ? metadataLeaf(expression) ?? residual : { sql, exact: true, test: record => evaluateExpression(record, expression, context, query.timezone) };
    };
    if (!query.where) return undefined;
    const compiled = compile(query.where);
    if (compiled.sql === 'true') return undefined;
    // Memory applies the same conservative tree as Cosmos. The service always follows it
    // with the complete evaluator, so residual fields never change result correctness.
    return { clause: compiled.sql, parameters, test: candidate => compiled.test({
        id: candidate.id, scopeKey: candidate.domain,
        fields: { page: candidate.path, number: candidate.number, openedBy: candidate.authorId, private: candidate.private === true,
            status: candidate.resolved ? 'done' : candidate.verification?.outcome === 'pending' ? 'ready' : candidate.inProgress ? 'in-progress' : 'open',
            priority: ['urgent', 'high', 'low'].includes(candidate.priority ?? '') ? candidate.priority : 'normal' }, searchText: ''
    }, candidate) };
}
