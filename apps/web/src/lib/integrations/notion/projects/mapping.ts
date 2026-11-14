import { z } from 'zod';
import { MAX_PROJECT_URLS, MAX_PROJECT_NAME_LENGTH } from '../../../app/limits';
import { defaultProjectName, normalizeSiteUrl } from '../../../app/siteUrl';
import { array, NotionApiError, object, pageProperty, propertyId, richText, type JsonObject } from '../client';
import type { NotionSchema } from '../model';
import { urlPropertyTypes, statusPropertyTypes, type NotionProjectMapping } from './model';

export const notionProjectMappingSchema = z.object({
    urls: z.array(z.string().max(128)).min(1).max(MAX_PROJECT_URLS), name: z.string().max(128).optional(),
    status: z.string().max(128), done: z.array(z.string().trim().min(1).max(100)).min(1).max(100)
}).strict();
export function validateProjectMapping(value: unknown, schema: NotionSchema): NotionProjectMapping {
    const parsed = notionProjectMappingSchema.safeParse(value);
    if (!parsed.success) throw new NotionApiError(400, 'mapping_invalid');
    const mapping = parsed.data;
    const ids = [...mapping.urls, mapping.status, ...(mapping.name ? [mapping.name] : [])];
    ids.forEach(propertyId);
    if (new Set(ids).size !== ids.length || mapping.urls.some(id => !urlPropertyTypes.includes(schema[id]?.type ?? ''))
        || (mapping.name && !['title', 'rich_text'].includes(schema[mapping.name]?.type ?? ''))
        || !statusPropertyTypes.includes(schema[mapping.status]?.type ?? '')) throw new NotionApiError(400, 'mapping_invalid');
    const status = schema[mapping.status]!;
    if ((['status', 'select'].includes(status.type) && mapping.done.some(value => !status.options?.includes(value)))
        || (status.type === 'checkbox' && (mapping.done.length !== 1 || mapping.done[0] !== 'true')))
        throw new NotionApiError(400, 'mapping_invalid');
    return mapping;
}
export function projectFromNotionRow(row: JsonObject, mapping: NotionProjectMapping, schema: NotionSchema) {
    if (row.object !== 'page' || row.in_trash || row.archived) return null;
    const read = (id: string) => {
        const value = pageProperty(row, id);
        if (value.type !== schema[id]?.type) throw new NotionApiError(400, 'row_invalid');
        return value;
    };
    const inputs = mapping.urls.flatMap(id => {
        const value = read(id);
        if (value.type === 'url') return value.url == null ? [] : [String(value.url)];
        if (value.type === 'multi_select') return array(value.multi_select).map(item => String(object(item).name ?? ''));
        // A text cell may hold several addresses separated by whitespace, commas or semicolons.
        return richText(value[String(value.type)]).split(/[\s,;]+/).filter(Boolean);
    }).filter(Boolean);
    if (!inputs.length) return null;
    if (inputs.length > 100 || inputs.some(value => !normalizeSiteUrl(value))) throw new NotionApiError(400, 'row_invalid');
    const urls = [...new Set(inputs.map(value => normalizeSiteUrl(value)!))];
    if (urls.length > MAX_PROJECT_URLS) throw new NotionApiError(400, 'row_invalid');
    const name = mapping.name ? richText(read(mapping.name)[schema[mapping.name]!.type]).trim() : '';
    const parsedName = z.string().trim().min(1).max(MAX_PROJECT_NAME_LENGTH).safeParse(name || defaultProjectName(urls[0]!));
    if (!parsedName.success) throw new NotionApiError(400, 'row_invalid');
    const status = read(mapping.status);
    const value = status.type === 'checkbox' ? String(status.checkbox)
        : status.type === 'rich_text' ? richText(status.rich_text).trim() : String(object(status[String(status.type)]).name ?? '');
    return { urls, name: parsedName.data, status: mapping.done.includes(value) ? 'done' as const : 'active' as const };
}
