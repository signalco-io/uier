import { z } from 'zod';
import { apiErrors, commentsApiHandler, parseJsonBody } from '../../../../src/lib/comments/http';
import { setUserToolbarLanguage, userToolbarLanguageSchema } from '../../../../src/lib/app/toolbarLanguage';
import { accountUserId } from '../../../../src/lib/comments/visitor';

// POST /api/visitor/language - the signed-in account's toolbar language on uier's own pages (`null`
// clears it), the same preference as Account → Toolbar language and a project's review API. Writes are
// same-origin (`commentsApiHandler`); a guest's choice stays in their browser, so guests are refused
// before the body is read, and no visitor cookie is created.
export const POST = commentsApiHandler(async ({ request, visitor }) => {
    const userId = accountUserId(visitor);
    if (!userId)
        throw apiErrors.signInRequired('Sign in to save your language. Without an account it stays in this browser.');
    const { language } = await parseJsonBody(request, z.object({ language: userToolbarLanguageSchema }).strict());
    return Response.json({ language: await setUserToolbarLanguage(userId, language) });
}, { createVisitor: false });
