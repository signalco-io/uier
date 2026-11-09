import { apiErrors } from '../comments/http';
import { isToolbarPosition, type positionSchema } from '../comments/validation';
import type { z } from 'zod';

/**
 * uier's own toolbar is reviewed only on uier's own pages. A request from a project's site (a
 * cross-origin `Origin`, `siteOrigin`) never anchors a comment to the toolbar or its layers, whatever
 * the toolbar on that page was made to send.
 */
export function assertNotToolbarAnchor(siteOrigin: string | undefined, position: z.infer<typeof positionSchema>) {
    if (siteOrigin && isToolbarPosition(position))
        throw apiErrors.invalidRequest('Comments on this site cannot be pinned to the uier toolbar.');
}
