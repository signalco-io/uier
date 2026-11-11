import { z } from 'zod';
import { feedbackStages } from '@uier/toolbar/verification';
import { boardSortOptions, boardSorts } from './boardSort';

/** Write validation stays separate from the board's browser-safe choices and defaults. */
export const boardSortInputSchema = z.object({
    status: z.enum(feedbackStages),
    sort: z.enum(boardSorts)
}).refine(({ status, sort }) => boardSortOptions(status).includes(sort), 'Choose a sort this column offers.');
