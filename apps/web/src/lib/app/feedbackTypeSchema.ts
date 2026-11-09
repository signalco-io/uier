import { z } from 'zod';
import { customFeedbackTypePattern, defaultFeedbackTypes, feedbackTypeIcons, MAX_FEEDBACK_TYPES, MAX_FEEDBACK_TYPE_LABEL, MAX_FEEDBACK_TYPE_PLACEHOLDER } from '@uier/toolbar/feedback-types';
import { projectSettingSchema } from './inheritedSettings';

export const feedbackTypeIdSchema = z.union([z.enum(['feedback', 'bug']), z.string().regex(customFeedbackTypePattern) as z.ZodType<`custom_${string}`>]);
const displayText = (max: number) => z.string().trim().min(1, 'Enter text for this feedback type.').max(max)
    .refine(text => !/[\p{Cc}\p{Cf}]/u.test(text), 'Use plain text without control characters.');
export const feedbackTypeSchema = z.object({
    id: feedbackTypeIdSchema,
    label: displayText(MAX_FEEDBACK_TYPE_LABEL),
    icon: z.enum(feedbackTypeIcons),
    placeholder: displayText(MAX_FEEDBACK_TYPE_PLACEHOLDER),
    enabled: z.boolean()
}).strict();
export const feedbackTypesSchema = z.array(feedbackTypeSchema).min(2).max(MAX_FEEDBACK_TYPES).superRefine((types, ctx) => {
    if (new Set(types.map(type => type.id)).size !== types.length)
        ctx.addIssue({ code: 'custom', message: 'Each feedback type needs a unique ID.' });
    if (new Set(types.map(type => type.label.toLowerCase())).size !== types.length)
        ctx.addIssue({ code: 'custom', message: 'Give each feedback type a different name.' });
    for (const builtin of defaultFeedbackTypes) {
        const type = types.find(type => type.id === builtin.id);
        if (!type || type.label !== builtin.label || type.icon !== builtin.icon)
            ctx.addIssue({ code: 'custom', message: 'Keep the standard feedback types. Turn them off to hide them.' });
    }
});
export const projectFeedbackTypesSchema = projectSettingSchema(feedbackTypesSchema)
    .refine(setting => setting.mode === 'replace', 'Choose workspace defaults or a project override.');
