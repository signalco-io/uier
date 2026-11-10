import { z } from 'zod';
import { toolbarFeatures } from '@uier/toolbar/toolbar-features';

const featureList = z.array(z.enum(toolbarFeatures)).max(toolbarFeatures.length)
    .refine(values => new Set(values).size === values.length, 'Choose each toolbar feature once.');
export const toolbarFeatureVisibilitySchema = z.object({
    enabled: featureList.optional(),
    signedOut: featureList.optional()
}).strict();
