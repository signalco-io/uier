/** Archive is separate from workflow status. Missing fields on old records mean not archived. */
export type ArchiveFilter = 'exclude' | 'only' | 'all';

export function archiveFilter(value: string | null): ArchiveFilter {
    return value === 'only' || value === 'all' ? value : 'exclude';
}

export function matchesArchive(comment: { archivedAt?: string }, filter: ArchiveFilter = 'all') {
    return filter === 'all' || Boolean(comment.archivedAt) === (filter === 'only');
}

export function archiveSql(filter: ArchiveFilter = 'all') {
    return filter === 'all' ? '' : filter === 'only' ? ' AND IS_STRING(c.archivedAt)' : ' AND NOT IS_STRING(c.archivedAt)';
}
