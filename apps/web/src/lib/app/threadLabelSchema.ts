import { z } from 'zod';
import { labelColors, labelIcons, MAX_THREAD_LABELS } from './threadLabel';

const plainText = (max: number) => z.string().trim().max(max).refine(text => !/[\p{Cc}\p{Cf}]/u.test(text), 'Use plain text without control characters.');
export const threadLabelIdSchema = z.string().regex(/^label_[a-zA-Z0-9_-]{1,64}$/);
export const threadLabelsSchema = z.array(z.object({
    id: threadLabelIdSchema, name: plainText(40).min(1), color: z.enum(labelColors).default('ink'),
    icon: z.enum(labelIcons).optional(), description: plainText(500).default('')
}).strict()).max(50).superRefine((labels, ctx) => {
    if (new Set(labels.map(label => label.id)).size !== labels.length) ctx.addIssue({ code: 'custom', message: 'Each label needs a unique ID.' });
    if (new Set(labels.map(label => label.name.toLowerCase())).size !== labels.length) ctx.addIssue({ code: 'custom', message: 'Give each label a different name.' });
});
export const projectThreadLabelsSchema = z.object({ mode: z.literal('replace'), value: threadLabelsSchema }).strict();
export const threadLabelIdsSchema = z.array(threadLabelIdSchema).min(1).max(MAX_THREAD_LABELS)
    .refine(ids => new Set(ids).size === ids.length, 'Choose distinct labels.');
export const threadLabelModeSchema = z.enum(['add', 'remove']);
