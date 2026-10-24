import { useMutation } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { apiRequest, required } from './api';

// A project's toolbar asks the review API, which applies the project's "who can comment" setting
const rewriteApiUrl = toolbarConfig.project
    ? `${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/rewrite`
    : `${toolbarConfig.apiUrl}/api/rewrite`;

export type RewriteRequest = {
    /** The selected page text */
    text: string;
    /** What the reviewer wants changed ("shorter", "friendlier"), optional */
    instruction?: string;
};

async function suggestRewrites({ text, instruction }: RewriteRequest) {
    const result = required(await apiRequest<{ suggestions?: unknown }>(rewriteApiUrl, {
        method: 'POST',
        body: { text, instruction: instruction?.trim() || undefined }
    }));
    return Array.isArray(result.suggestions)
        ? result.suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : [];
}

/** AI rewrite suggestions for selected text (`POST /api/rewrite`, or the project's review API) */
export function useRewriteSuggestions() {
    return useMutation({ mutationFn: suggestRewrites });
}
