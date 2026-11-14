import { z } from 'zod';
import { notionProjectMappingSchema } from '../../../../lib/integrations/notion/projects/mapping';
export const sourceIdSchema = z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
export const mappingActionSchema = z.object({ dataSourceId: sourceIdSchema, mapping: notionProjectMappingSchema });
export const stopActionSchema = z.enum(['pause', 'disconnect']);
export const manualProjectSchema = z.string().regex(/^[a-z0-9]{12}$/);
