/** Storage filtering happens before TOP/limit so another environment cannot hide older results. */
export type OriginFilter = { origins: string[]; exclude?: boolean; unknown?: boolean };

export function matchesOrigin(origin: string | undefined, filter?: OriginFilter) {
    if (!filter) return true;
    if (!origin) return filter.unknown === true;
    return filter.exclude ? !filter.origins.includes(origin) : filter.origins.includes(origin);
}

export function originSql(filter?: OriginFilter) {
    if (!filter) return { clause: '', parameters: [] };
    const known = `${filter.exclude ? 'NOT ' : ''}ARRAY_CONTAINS(@origins, c.origin)`;
    return {
        clause: ` AND ((IS_STRING(c.origin) AND c.origin != "" AND ${known})${filter.unknown ? ' OR NOT IS_DEFINED(c.origin) OR IS_NULL(c.origin) OR c.origin = ""' : ''})`,
        parameters: [{ name: '@origins', value: filter.origins }]
    };
}
